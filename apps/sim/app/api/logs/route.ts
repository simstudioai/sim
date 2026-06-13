import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { listLogsContract } from '@/lib/api/contracts/logs'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listLogs } from '@/lib/logs/list-logs'

const logger = createLogger('LogsAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }
  const userId = authResult.userId

  const parsed = await parseRequest(listLogsContract, request, {})
  if (!parsed.success) return parsed.response

  const params = parsed.data.query
  const result = await listLogs(params, userId)

  logger.debug('Listed logs', {
    workspaceId: params.workspaceId,
    count: result.data.length,
    hasMore: result.nextCursor !== null,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  })

  return NextResponse.json(result)
})
