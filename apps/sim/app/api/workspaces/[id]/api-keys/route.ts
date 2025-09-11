import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateApiKey, generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { apiKey, workspace, workspaceApiKey } from '@/db/schema'

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

    // Validate workspace exists
    const ws = await db.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
    if (!ws.length) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Require any permission to read
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch workspace API keys
    const workspaceKeys = await db
      .select({
        id: workspaceApiKey.id,
        name: workspaceApiKey.name,
        key: workspaceApiKey.key,
        createdAt: workspaceApiKey.createdAt,
        lastUsed: workspaceApiKey.lastUsed,
        expiresAt: workspaceApiKey.expiresAt,
        createdBy: workspaceApiKey.createdBy,
      })
      .from(workspaceApiKey)
      .where(eq(workspaceApiKey.workspaceId, workspaceId))
      .orderBy(workspaceApiKey.createdAt)

    // Fetch personal API keys for the user
    const personalKeys = await db
      .select({
        id: apiKey.id,
        name: apiKey.name,
        key: apiKey.key,
        createdAt: apiKey.createdAt,
        lastUsed: apiKey.lastUsed,
        expiresAt: apiKey.expiresAt,
      })
      .from(apiKey)
      .where(eq(apiKey.userId, userId))
      .orderBy(apiKey.createdAt)

    // Find conflicts (same name in both workspace and personal keys)
    const workspaceKeyNames = new Set(workspaceKeys.map((k) => k.name))
    const personalKeyNames = new Set(personalKeys.map((k) => k.name))
    const conflicts = Array.from(workspaceKeyNames).filter((name) => personalKeyNames.has(name))

    return NextResponse.json({
      data: {
        workspace: workspaceKeys,
        personal: personalKeys,
        conflicts,
      },
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace API keys GET error`, error)
    return NextResponse.json({ error: error.message || 'Failed to load API keys' }, { status: 500 })
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

    // Require admin or write permission to create workspace API keys
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name } = CreateKeySchema.parse(body)

    // Check if a key with this name already exists in the workspace
    const existingKey = await db
      .select()
      .from(workspaceApiKey)
      .where(and(eq(workspaceApiKey.workspaceId, workspaceId), eq(workspaceApiKey.name, name)))
      .limit(1)

    if (existingKey.length > 0) {
      return NextResponse.json(
        {
          error: `A workspace API key named "${name}" already exists. Please choose a different name.`,
        },
        { status: 409 }
      )
    }

    const keyValue = generateApiKey()

    // Insert the new workspace API key
    const [newKey] = await db
      .insert(workspaceApiKey)
      .values({
        id: nanoid(),
        workspaceId,
        createdBy: userId,
        name,
        key: keyValue,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({
        id: workspaceApiKey.id,
        name: workspaceApiKey.name,
        key: workspaceApiKey.key,
        createdAt: workspaceApiKey.createdAt,
      })

    logger.info(`[${requestId}] Created workspace API key: ${name} in workspace ${workspaceId}`)
    return NextResponse.json({ key: newKey })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace API key POST error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to create workspace API key' },
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

    // Require admin or write permission to delete workspace API keys
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { keys } = DeleteKeysSchema.parse(body)

    // Delete the specified workspace API keys
    const deletedCount = await db.delete(workspaceApiKey).where(
      and(
        eq(workspaceApiKey.workspaceId, workspaceId),
        // Use the `inArray` operator for multiple keys
        workspaceApiKey.id.in(keys)
      )
    )

    logger.info(
      `[${requestId}] Deleted ${deletedCount} workspace API keys from workspace ${workspaceId}`
    )
    return NextResponse.json({ success: true, deletedCount })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace API key DELETE error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete workspace API keys' },
      { status: 500 }
    )
  }
}
