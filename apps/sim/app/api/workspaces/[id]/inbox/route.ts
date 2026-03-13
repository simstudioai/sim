import { db, mothershipInboxTask, workspace } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { hasInboxAccess } from '@/lib/billing/core/subscription'
import { disableInbox, enableInbox, updateInboxAddress } from '@/lib/mothership/inbox/lifecycle'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InboxConfigAPI')

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  username: z.string().min(1).max(64).optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [hasAccess, permission] = await Promise.all([
    hasInboxAccess(session.user.id),
    getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
  ])
  if (!hasAccess) {
    return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
  }
  if (!permission) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [wsResult, statsResult] = await Promise.all([
    db
      .select({
        inboxEnabled: workspace.inboxEnabled,
        inboxAddress: workspace.inboxAddress,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db
      .select({
        status: mothershipInboxTask.status,
        count: sql<number>`count(*)::int`,
      })
      .from(mothershipInboxTask)
      .where(eq(mothershipInboxTask.workspaceId, workspaceId))
      .groupBy(mothershipInboxTask.status),
  ])

  const [ws] = wsResult
  if (!ws) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const stats = {
    total: 0,
    completed: 0,
    processing: 0,
    failed: 0,
  }
  for (const row of statsResult) {
    const count = Number(row.count)
    stats.total += count
    if (row.status === 'completed') stats.completed = count
    else if (row.status === 'processing') stats.processing = count
    else if (row.status === 'failed') stats.failed = count
  }

  return NextResponse.json({
    enabled: ws.inboxEnabled,
    address: ws.inboxAddress,
    taskStats: stats,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [hasAccess, permission] = await Promise.all([
    hasInboxAccess(session.user.id),
    getUserEntityPermissions(session.user.id, 'workspace', workspaceId),
  ])
  if (!hasAccess) {
    return NextResponse.json({ error: 'Sim Mailer requires a Max plan' }, { status: 403 })
  }
  if (permission !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const body = patchSchema.parse(await req.json())

    if (body.enabled === true) {
      const [current] = await db
        .select({ inboxEnabled: workspace.inboxEnabled })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)
      if (current?.inboxEnabled) {
        return NextResponse.json({ error: 'Inbox is already enabled' }, { status: 409 })
      }
      const config = await enableInbox(workspaceId, { username: body.username })
      return NextResponse.json(config)
    }

    if (body.enabled === false) {
      await disableInbox(workspaceId)
      return NextResponse.json({ enabled: false, address: null })
    }

    if (body.username) {
      const config = await updateInboxAddress(workspaceId, body.username)
      return NextResponse.json(config)
    }

    return NextResponse.json({ error: 'No valid update provided' }, { status: 400 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', details: error.errors }, { status: 400 })
    }

    logger.error('Inbox config update failed', {
      workspaceId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update inbox' },
      { status: 500 }
    )
  }
}
