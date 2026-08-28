import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { cloudwatchLogGroupsSelectorContract } from '@/lib/api/contracts/selectors/cloudwatch'
import { parseToolRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listCloudWatchLogGroups } from '@/tools/cloudwatch/listing'

const logger = createLogger('CloudWatchDescribeLogGroups')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(cloudwatchLogGroupsSelectorContract, request, {
      errorFormat: 'firstError',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Describing CloudWatch log groups')

    const logGroups = await listCloudWatchLogGroups({
      credentials: {
        region: validatedData.region,
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
      prefix: validatedData.prefix,
      limit: validatedData.limit,
      signal: request.signal,
    })

    logger.info(`Successfully described ${logGroups.length} log groups`)
    return NextResponse.json({ success: true, output: { logGroups } })
  } catch (error) {
    logger.error('DescribeLogGroups failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch log groups: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
