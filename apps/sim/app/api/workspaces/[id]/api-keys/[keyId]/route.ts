import { db } from '@sim/db'
import { apiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, not } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

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

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { name } = UpdateKeySchema.parse(body)

    const existingKey = await db
      .select()
      .from(apiKey)
      .where(
        and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.id, keyId), eq(apiKey.type, 'workspace'))
      )
      .limit(1)

    if (existingKey.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    const conflictingKey = await db
      .select()
      .from(apiKey)
      .where(
        and(
          eq(apiKey.workspaceId, workspaceId),
          eq(apiKey.name, name),
          eq(apiKey.type, 'workspace'),
          not(eq(apiKey.id, keyId))
        )
      )
      .limit(1)

    if (conflictingKey.length > 0) {
      return NextResponse.json(
        { error: 'A workspace API key with this name already exists' },
        { status: 400 }
      )
    }

    const [updatedKey] = await db
      .update(apiKey)
      .set({
        name,
        updatedAt: new Date(),
      })
      .where(
        and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.id, keyId), eq(apiKey.type, 'workspace'))
      )
      .returning({
        id: apiKey.id,
        name: apiKey.name,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
      })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.API_KEY_UPDATED,
      resourceType: AuditResourceType.API_KEY,
      resourceId: keyId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: name,
      description: `Updated workspace API key: ${name}`,
      request,
    })

    logger.info(`[${requestId}] Updated workspace API key: ${keyId} in workspace ${workspaceId}`)
    return NextResponse.json({ key: updatedKey })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workspace API key PUT error`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update workspace API key' },
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

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const deletedRows = await db
      .delete(apiKey)
      .where(
        and(eq(apiKey.workspaceId, workspaceId), eq(apiKey.id, keyId), eq(apiKey.type, 'workspace'))
      )
      .returning({ id: apiKey.id, name: apiKey.name })

    if (deletedRows.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }

    const deletedKey = deletedRows[0]

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.API_KEY_REVOKED,
      resourceType: AuditResourceType.API_KEY,
      resourceId: keyId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: deletedKey.name,
      description: `Revoked workspace API key: ${deletedKey.name}`,
      request,
    })

    logger.info(`[${requestId}] Deleted workspace API key: ${keyId} from workspace ${workspaceId}`)
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    logger.error(`[${requestId}] Workspace API key DELETE error`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete workspace API key' },
      { status: 500 }
    )
  }
}
