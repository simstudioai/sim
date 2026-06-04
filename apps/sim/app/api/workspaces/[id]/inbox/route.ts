import { db, mothershipInboxTask, workspace } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateInboxConfigContract } from '@/lib/api/contracts/inbox'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { hasInboxAccess } from '@/lib/billing/core/subscription'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { disableInbox, enableInbox, updateInboxAddress } from '@/lib/mothership/inbox/lifecycle'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InboxConfigAPI')

export const GET = withRouteHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
)

export const PATCH = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id: workspaceId } = await context.params
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
      const parsed = await parseRequest(updateInboxConfigContract, req, context)
      if (!parsed.success) return parsed.response
      const body = parsed.data.body

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
      logger.error('Inbox config update failed', {
        workspaceId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to update inbox') },
        { status: 500 }
      )
    }
  }
)
