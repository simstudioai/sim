import { db, mothershipInboxTask } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, desc, eq, lt } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasInboxAccess } from '@/lib/billing/core/subscription'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InboxTasksAPI')

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || 'all'
  const limit = Math.min(Number(url.searchParams.get('limit') || '20'), 50)
  const cursor = url.searchParams.get('cursor') // ISO date string for cursor-based pagination

  const conditions = [eq(mothershipInboxTask.workspaceId, workspaceId)]

  const validStatuses = ['received', 'processing', 'completed', 'failed', 'rejected'] as const
  if (status !== 'all') {
    if (!validStatuses.includes(status as (typeof validStatuses)[number])) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
    }
    conditions.push(eq(mothershipInboxTask.status, status))
  }

  if (cursor) {
    const cursorDate = new Date(cursor)
    if (Number.isNaN(cursorDate.getTime())) {
      return NextResponse.json({ error: 'Invalid cursor value' }, { status: 400 })
    }
    conditions.push(lt(mothershipInboxTask.createdAt, cursorDate))
  }

  const tasks = await db
    .select({
      id: mothershipInboxTask.id,
      fromEmail: mothershipInboxTask.fromEmail,
      fromName: mothershipInboxTask.fromName,
      subject: mothershipInboxTask.subject,
      bodyPreview: mothershipInboxTask.bodyPreview,
      status: mothershipInboxTask.status,
      hasAttachments: mothershipInboxTask.hasAttachments,
      resultSummary: mothershipInboxTask.resultSummary,
      errorMessage: mothershipInboxTask.errorMessage,
      rejectionReason: mothershipInboxTask.rejectionReason,
      chatId: mothershipInboxTask.chatId,
      createdAt: mothershipInboxTask.createdAt,
      completedAt: mothershipInboxTask.completedAt,
    })
    .from(mothershipInboxTask)
    .where(and(...conditions))
    .orderBy(desc(mothershipInboxTask.createdAt))
    .limit(limit + 1) // Fetch one extra to determine hasMore

  const hasMore = tasks.length > limit
  const resultTasks = hasMore ? tasks.slice(0, limit) : tasks
  const nextCursor =
    hasMore && resultTasks.length > 0
      ? resultTasks[resultTasks.length - 1].createdAt.toISOString()
      : null

  return NextResponse.json({
    tasks: resultTasks,
    pagination: {
      limit,
      hasMore,
      nextCursor,
    },
  })
}
