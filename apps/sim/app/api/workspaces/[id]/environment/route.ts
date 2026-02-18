import { db } from '@sim/db'
import { workspaceEnvironment } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { generateRequestId } from '@/lib/core/utils/request'
import { syncWorkspaceEnvCredentials } from '@/lib/credentials/environment'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { getUserEntityPermissions, getWorkspaceById } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceEnvironmentAPI')

const UpsertSchema = z.object({
  variables: z.record(z.string()),
})

const DeleteSchema = z.object({
  keys: z.array(z.string()).min(1),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workspace env access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Validate workspace exists
    const ws = await getWorkspaceById(workspaceId)
    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Require any permission to read
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspaceDecrypted, personalDecrypted, conflicts } = await getPersonalAndWorkspaceEnv(
      userId,
      workspaceId
    )

    return NextResponse.json(
      {
        data: {
          workspace: workspaceDecrypted,
          personal: personalDecrypted,
          conflicts,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace env GET error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to load environment' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workspaceId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workspace env update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { variables } = UpsertSchema.parse(body)

    // Read existing encrypted ws vars
    const existingRows = await db
      .select()
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1)

    const existingEncrypted: Record<string, string> = (existingRows[0]?.variables as any) || {}

    // Encrypt incoming
    const encryptedIncoming = await Promise.all(
      Object.entries(variables).map(async ([key, value]) => {
        const { encrypted } = await encryptSecret(value)
        return [key, encrypted] as const
      })
    ).then((entries) => Object.fromEntries(entries))

    const merged = { ...existingEncrypted, ...encryptedIncoming }

    // Upsert by unique workspace_id
    await db
      .insert(workspaceEnvironment)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        variables: merged,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceEnvironment.workspaceId],
        set: { variables: merged, updatedAt: new Date() },
      })

    await syncWorkspaceEnvCredentials({
      workspaceId,
      envKeys: Object.keys(merged),
      actingUserId: userId,
    })

    recordAudit({
      workspaceId,
      actorId: userId,
      actorName: session?.user?.name,
      actorEmail: session?.user?.email,
      action: AuditAction.ENVIRONMENT_UPDATED,
      resourceType: AuditResourceType.ENVIRONMENT,
      resourceId: workspaceId,
      description: `Updated environment variables`,
      metadata: { keysUpdated: Object.keys(variables) },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace env PUT error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to update environment' },
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
      logger.warn(`[${requestId}] Unauthorized workspace env delete attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission || (permission !== 'admin' && permission !== 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { keys } = DeleteSchema.parse(body)

    const wsRows = await db
      .select()
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, workspaceId))
      .limit(1)

    const current: Record<string, string> = (wsRows[0]?.variables as any) || {}
    let changed = false
    for (const k of keys) {
      if (k in current) {
        delete current[k]
        changed = true
      }
    }

    if (!changed) {
      return NextResponse.json({ success: true })
    }

    await db
      .insert(workspaceEnvironment)
      .values({
        id: wsRows[0]?.id || crypto.randomUUID(),
        workspaceId,
        variables: current,
        createdAt: wsRows[0]?.createdAt || new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceEnvironment.workspaceId],
        set: { variables: current, updatedAt: new Date() },
      })

    await syncWorkspaceEnvCredentials({
      workspaceId,
      envKeys: Object.keys(current),
      actingUserId: userId,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error(`[${requestId}] Workspace env DELETE error`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to remove environment keys' },
      { status: 500 }
    )
  }
}
