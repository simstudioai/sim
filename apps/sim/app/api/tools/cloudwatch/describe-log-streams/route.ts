import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { cloudwatchLogStreamsSelectorContract } from '@/lib/api/contracts/selectors/cloudwatch'
import { parseToolRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listCloudWatchLogStreams } from '@/tools/cloudwatch/listing'

const logger = createLogger('CloudWatchDescribeLogStreams')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(cloudwatchLogStreamsSelectorContract, request, {
      errorFormat: 'firstError',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Describing log streams for group: ${validatedData.logGroupName}`)

    const logStreams = await listCloudWatchLogStreams({
      credentials: {
        region: validatedData.region,
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
      logGroupName: validatedData.logGroupName,
      prefix: validatedData.prefix,
      limit: validatedData.limit,
      signal: request.signal,
    })

    logger.info(`Successfully described ${logStreams.length} log streams`)
    return NextResponse.json({ success: true, output: { logStreams } })
  } catch (error) {
    logger.error('DescribeLogStreams failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch log streams: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
