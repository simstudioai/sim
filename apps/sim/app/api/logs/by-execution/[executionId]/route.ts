import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getLogByExecutionIdContract } from '@/lib/api/contracts/logs'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchLogDetail } from '@/lib/logs/fetch-log-detail'

const logger = createLogger('LogDetailsByExecutionAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ executionId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getLogByExecutionIdContract, request, context)
    if (!parsed.success) return parsed.response

    const { executionId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const data = await fetchLogDetail({
      userId: session.user.id,
      workspaceId,
      lookupColumn: 'executionId',
      lookupValue: executionId,
    })

    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    logger.debug('Fetched log by execution id', { executionId, workspaceId })
    return NextResponse.json({ data })
  }
)
