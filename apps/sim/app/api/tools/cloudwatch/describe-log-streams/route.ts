import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { cloudwatchLogStreamsSelectorContract } from '@/lib/api/contracts/selectors/cloudwatch'
import { parseToolRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient, describeLogStreams } from '@/app/api/tools/cloudwatch/utils'

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

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await describeLogStreams(client, validatedData.logGroupName, {
        prefix: validatedData.prefix,
        limit: validatedData.limit,
      })

      logger.info(`Successfully described ${result.logStreams.length} log streams`)

      return NextResponse.json({
        success: true,
        output: { logStreams: result.logStreams },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('DescribeLogStreams failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch log streams: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
