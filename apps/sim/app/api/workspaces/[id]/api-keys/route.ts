import { db } from '@sim/db'
import { apiKey, workspace } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createApiKey, getApiKeyDisplayFormat } from '@/lib/api-key/auth'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('WorkspaceApiKeysAPI')

const CreateKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
})

const DeleteKeysSchema = z.object({
  keys: z.array(z.string()).min(1),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workspace API keys access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const ws = await db.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
    if (!ws.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceKeys = await db
      .select({
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        createdAt: apiKey.createdAt,
        lastUsed: apiKey.lastUsed,
        expiresAt: apiKey.expiresAt,
        createdBy: apiKey.createdBy,
      })
      .from(apiKey)
      .where(and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.type, 'workspace')))
      .orderBy(apiKey.createdAt)

    const formattedWorkspaceKeys = await Promise.all(
      workspaceKeys.map(async (key) => {
        const displayFormat = await getApiKeyDisplayFormat(key.key)
        return {
          ...key,
          key: key.key,
          displayKey: displayFormat,
        }
      })
    )

    return NextResponse.json({
      keys: formattedWorkspaceKeys,
    })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workspace API keys GET error`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load API keys' },
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
      logger.warn(`[${requestId}] Unauthorized workspace API key creation attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const workspaceRows = await db
      .select({ billedAccountUserId: workspace.billedAccountUserId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceRows.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (workspaceRows[0].billedAccountUserId !== userId) {
      return NextResponse.json(
        { error: 'Only the workspace billing account can create workspace API keys' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name } = CreateKeySchema.parse(body)

    const existingKey = await db
      .select()
      .from(apiKey)
      .where(
        and(
          eq(apiKey.workspaceId, workspaceId),
          eq(apiKey.name, name),
          eq(apiKey.type, 'workspace')
        )
      )
      .limit(1)

    if (existingKey.length > 0) {
      return NextResponse.json(
        {
          error: `A workspace API key named "${name}" already exists. Please choose a different name.`,
        },
        { status: 409 }
      )
    }

    const { key: plainKey, encryptedKey } = await createApiKey(true)

    if (!encryptedKey) {
      throw new Error('Failed to encrypt API key for storage')
    }

    const [newKey] = await db
      .insert(apiKey)
      .values({
        id: nanoid(),
        workspaceId,
        userId: userId,
        createdBy: userId,
        name,
        key: encryptedKey,
        type: 'workspace',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: apiKey.id,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
      })

    logger.info(`[${requestId}] Created workspace API key: ${name} in workspace ${workspaceId}`)

    return NextResponse.json({
      key: {
        ...newKey,
        key: plainKey,
      },
    })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workspace API key POST error`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create workspace API key' },
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
      logger.warn(`[${requestId}] Unauthorized workspace API key deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const workspaceRows = await db
      .select({ billedAccountUserId: workspace.billedAccountUserId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceRows.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (workspaceRows[0].billedAccountUserId !== userId) {
      return NextResponse.json(
        { error: 'Only the workspace billing account can delete workspace API keys' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { keys } = DeleteKeysSchema.parse(body)

    const deletedCount = await db
      .delete(apiKey)
      .where(
        and(
          eq(apiKey.workspaceId, workspaceId),
          eq(apiKey.type, 'workspace'),
          inArray(apiKey.id, keys)
        )
      )

    logger.info(
      `[${requestId}] Deleted ${deletedCount} workspace API keys from workspace ${workspaceId}`
    )
    return NextResponse.json({ success: true, deletedCount })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workspace API key DELETE error`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete workspace API keys' },
      { status: 500 }
    )
  }
}
