import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { db } from '@/db'
import { workspaceApiKey } from '@/db/schema'

const logger = createLogger('WorkspaceApiKeyAPI')

const UpdateKeySchema = z.object({
  name: z.string().min(1, 'Name is required'),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  const requestId = generateRequestId()
  const { id: workspaceId, keyId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workspace API key update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Require admin or write permission to update workspace API keys
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name } = UpdateKeySchema.parse(body)

    // Check if the key exists in this workspace
    const existingKey = await db
      .select()
      .from(workspaceApiKey)
      .where(and(eq(workspaceApiKey.workspaceId, workspaceId), eq(workspaceApiKey.id, keyId)))
      .limit(1)

    if (existingKey.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    // Check if a key with the new name already exists (excluding the current key)
    const conflictingKey = await db
      .select()
      .from(workspaceApiKey)
      .where(
        and(
          eq(workspaceApiKey.workspaceId, workspaceId),
          eq(workspaceApiKey.name, name),
          workspaceApiKey.id.ne(keyId)
        )
      )
      .limit(1)

    if (conflictingKey.length > 0) {
      return NextResponse.json(
        { error: 'A workspace API key with this name already exists' },
        { status: 400 }
      )
    }

    // Update the key name
    const [updatedKey] = await db
      .update(workspaceApiKey)
      .set({
        name,
        updatedAt: new Date(),
      })
      .where(and(eq(workspaceApiKey.workspaceId, workspaceId), eq(workspaceApiKey.id, keyId)))
      .returning({
        id: workspaceApiKey.id,
        name: workspaceApiKey.name,
        createdAt: workspaceApiKey.createdAt,
        updatedAt: workspaceApiKey.updatedAt,
      })

    logger.info(`[${requestId}] Updated workspace API key: ${keyId} in workspace ${workspaceId}`)
    return NextResponse.json({ key: updatedKey })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace API key PUT error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to update workspace API key' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> }
) {
  const requestId = generateRequestId()
  const { id: workspaceId, keyId } = await params

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

    // Delete the workspace API key
    const deletedRows = await db
      .delete(workspaceApiKey)
      .where(and(eq(workspaceApiKey.workspaceId, workspaceId), eq(workspaceApiKey.id, keyId)))
      .returning({ id: workspaceApiKey.id })

    if (deletedRows.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    logger.info(`[${requestId}] Deleted workspace API key: ${keyId} from workspace ${workspaceId}`)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace API key DELETE error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete workspace API key' },
      { status: 500 }
    )
  }
}
