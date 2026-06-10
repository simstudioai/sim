import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getLogByExecutionIdContract } from '@/lib/api/contracts/logs'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchLogDetail } from '@/lib/logs/fetch-log-detail'

const logger = createLogger('LogDetailsByExecutionAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ executionId: string }> }) => {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(getLogByExecutionIdContract, request, context)
    if (!parsed.success) return parsed.response

    const { executionId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const data = await fetchLogDetail({
      userId: authResult.userId,
      workspaceId,
      lookupColumn: 'executionId',
      lookupValue: executionId,
    })

    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    logger.debug('Fetched log by execution id', { executionId, workspaceId })
    return NextResponse.json({ data })
  }
)
