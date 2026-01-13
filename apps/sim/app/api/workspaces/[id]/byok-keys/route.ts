import { db } from '@sim/db'
import { workspaceBYOKKeys } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserEntityPermissions, getWorkspaceById } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceBYOKKeysAPI')

const VALID_PROVIDERS = ['openai', 'anthropic', 'google', 'mistral'] as const

const UpsertKeySchema = z.object({
  providerId: z.enum(VALID_PROVIDERS),
  apiKey: z.string().min(1, 'API key is required'),
})

const DeleteKeySchema = z.object({
  providerId: z.enum(VALID_PROVIDERS),
})

function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '•'.repeat(8)
  }
  if (key.length <= 12) {
    return `${key.slice(0, 4)}...${key.slice(-4)}`
  }
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized BYOK keys access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const ws = await getWorkspaceById(workspaceId)
    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const byokKeys = await db
      .select({
        id: workspaceBYOKKeys.id,
        providerId: workspaceBYOKKeys.providerId,
        encryptedApiKey: workspaceBYOKKeys.encryptedApiKey,
        createdBy: workspaceBYOKKeys.createdBy,
        createdAt: workspaceBYOKKeys.createdAt,
        updatedAt: workspaceBYOKKeys.updatedAt,
      })
      .from(workspaceBYOKKeys)
      .where(eq(workspaceBYOKKeys.workspaceId, workspaceId))
      .orderBy(workspaceBYOKKeys.providerId)

    const formattedKeys = await Promise.all(
      byokKeys.map(async (key) => {
        try {
          const { decrypted } = await decryptSecret(key.encryptedApiKey)
          return {
            id: key.id,
            providerId: key.providerId,
            maskedKey: maskApiKey(decrypted),
            createdBy: key.createdBy,
            createdAt: key.createdAt,
            updatedAt: key.updatedAt,
          }
        } catch (error) {
          logger.error(`[${requestId}] Failed to decrypt BYOK key for provider ${key.providerId}`, {
            error,
          })
          return {
            id: key.id,
            providerId: key.providerId,
            maskedKey: '••••••••',
            createdBy: key.createdBy,
            createdAt: key.createdAt,
            updatedAt: key.updatedAt,
          }
        }
      })
    )

    return NextResponse.json({ keys: formattedKeys })
  } catch (error: unknown) {
    logger.error(`[${requestId}] BYOK keys GET error`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load BYOK keys' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized BYOK key creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'admin') {
      return NextResponse.json(
        { error: 'Only workspace admins can manage BYOK keys' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { providerId, apiKey } = UpsertKeySchema.parse(body)

    const { encrypted } = await encryptSecret(apiKey)

    const existingKey = await db
      .select()
      .from(workspaceBYOKKeys)
      .where(
        and(
          eq(workspaceBYOKKeys.workspaceId, workspaceId),
          eq(workspaceBYOKKeys.providerId, providerId)
        )
      )
      .limit(1)

    if (existingKey.length > 0) {
      await db
        .update(workspaceBYOKKeys)
        .set({
          encryptedApiKey: encrypted,
          updatedAt: new Date(),
        })
        .where(eq(workspaceBYOKKeys.id, existingKey[0].id))

      logger.info(`[${requestId}] Updated BYOK key for ${providerId} in workspace ${workspaceId}`)

      return NextResponse.json({
        success: true,
        key: {
          id: existingKey[0].id,
          providerId,
          maskedKey: maskApiKey(apiKey),
          updatedAt: new Date(),
        },
      })
    }

    const [newKey] = await db
      .insert(workspaceBYOKKeys)
      .values({
        id: nanoid(),
        workspaceId,
        providerId,
        encryptedApiKey: encrypted,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: workspaceBYOKKeys.id,
        providerId: workspaceBYOKKeys.providerId,
        createdAt: workspaceBYOKKeys.createdAt,
      })

    logger.info(`[${requestId}] Created BYOK key for ${providerId} in workspace ${workspaceId}`)

    return NextResponse.json({
      success: true,
      key: {
        ...newKey,
        maskedKey: maskApiKey(apiKey),
      },
    })
  } catch (error: unknown) {
    logger.error(`[${requestId}] BYOK key POST error`, error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save BYOK key' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized BYOK key deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'admin') {
      return NextResponse.json(
        { error: 'Only workspace admins can manage BYOK keys' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { providerId } = DeleteKeySchema.parse(body)

    const result = await db
      .delete(workspaceBYOKKeys)
      .where(
        and(
          eq(workspaceBYOKKeys.workspaceId, workspaceId),
          eq(workspaceBYOKKeys.providerId, providerId)
        )
      )

    logger.info(`[${requestId}] Deleted BYOK key for ${providerId} from workspace ${workspaceId}`)

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    logger.error(`[${requestId}] BYOK key DELETE error`, error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete BYOK key' },
      { status: 500 }
    )
  }
}
