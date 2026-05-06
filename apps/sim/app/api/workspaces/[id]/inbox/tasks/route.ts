import { db, mothershipInboxTask } from '@sim/db'
import { and, desc, eq, lt } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { inboxTasksQuerySchema, inboxWorkspaceParamsSchema } from '@/lib/api/contracts/inbox'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { hasInboxAccess } from '@/lib/billing/core/subscription'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const GET = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const paramsResult = inboxWorkspaceParamsSchema.safeParse(await params)
    if (!paramsResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(paramsResult.error, 'Invalid route parameters') },
        { status: 400 }
      )
    }
    const { id: workspaceId } = paramsResult.data
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

    const queryResult = inboxTasksQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    )
    if (!queryResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(queryResult.error, 'Invalid query parameters') },
        { status: 400 }
      )
    }

    const { cursor } = queryResult.data
    const status = queryResult.data.status ?? 'all'
    const limit = queryResult.data.limit ?? 20

    const conditions = [eq(mothershipInboxTask.workspaceId, workspaceId)]

    if (status !== 'all') {
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
)
