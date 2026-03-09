import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { getUserUsageLogs, type UsageLogSource } from '@/lib/billing/core/usage-log'

const logger = createLogger('UsageLogsAPI')

const QuerySchema = z.object({
  source: z.enum(['workflow', 'wand', 'copilot']).optional(),
  workspaceId: z.string().optional(),
  period: z.enum(['1d', '7d', '30d', 'all']).optional().default('30d'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

/**
 * GET /api/users/me/usage-logs
 * Get usage logs for the authenticated user
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })

    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = auth.userId

    const { searchParams } = new URL(req.url)
    const queryParams = {
      source: searchParams.get('source') || undefined,
      workspaceId: searchParams.get('workspaceId') || undefined,
      period: searchParams.get('period') || '30d',
      limit: searchParams.get('limit') || '50',
      cursor: searchParams.get('cursor') || undefined,
    }

    const validation = QuerySchema.safeParse(queryParams)

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: validation.error.issues,
        },
        { status: 400 }
      )
    }

    const { source, workspaceId, period, limit, cursor } = validation.data

    let startDate: Date | undefined
    const endDate = new Date()

    if (period !== 'all') {
      startDate = new Date()
      switch (period) {
        case '1d':
          startDate.setDate(startDate.getDate() - 1)
          break
        case '7d':
          startDate.setDate(startDate.getDate() - 7)
          break
        case '30d':
          startDate.setDate(startDate.getDate() - 30)
          break
      }
    }

    const result = await getUserUsageLogs(userId, {
      source: source as UsageLogSource | undefined,
      workspaceId,
      startDate,
      endDate,
      limit,
      cursor,
    })

    logger.debug('Retrieved usage logs', {
      userId,
      source,
      period,
      logCount: result.logs.length,
      hasMore: result.pagination.hasMore,
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    logger.error('Failed to get usage logs', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        error: 'Failed to retrieve usage logs',
      },
      { status: 500 }
    )
  }
}
