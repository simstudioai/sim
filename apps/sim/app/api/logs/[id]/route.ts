import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getLogDetailContract } from '@/lib/api/contracts/logs'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchLogDetail } from '@/lib/logs/fetch-log-detail'

const logger = createLogger('LogDetailsByIdAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(getLogDetailContract, request, context)
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const data = await fetchLogDetail({
      userId: session.user.id,
      workspaceId,
      lookupColumn: 'id',
      lookupValue: id,
    })

    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    logger.debug('Fetched log detail', { id, workspaceId })
    return NextResponse.json({ data })
  }
)
