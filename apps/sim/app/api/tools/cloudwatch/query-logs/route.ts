import { StartQueryCommand } from '@aws-sdk/client-cloudwatch-logs'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchQueryLogsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-query-logs'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient, pollQueryResults } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchQueryLogs')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchQueryLogsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Running CloudWatch Log Insights query')

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const startQueryCommand = new StartQueryCommand({
        logGroupNames: validatedData.logGroupNames,
        queryString: validatedData.queryString,
        startTime: validatedData.startTime,
        endTime: validatedData.endTime,
        ...(validatedData.limit !== undefined && { limit: validatedData.limit }),
      })

      const startQueryResponse = await client.send(startQueryCommand)
      const queryId = startQueryResponse.queryId

      if (!queryId) {
        throw new Error('Failed to start CloudWatch Log Insights query: no queryId returned')
      }

      const result = await pollQueryResults(client, queryId)

      logger.info(`Query completed with status: ${result.status}`)

      return NextResponse.json({
        success: true,
        output: {
          results: result.results,
          statistics: result.statistics,
          status: result.status,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('QueryLogs failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `CloudWatch Log Insights query failed: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
