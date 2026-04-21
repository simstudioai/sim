import { StartQueryCommand } from '@aws-sdk/client-cloudwatch-logs'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient, pollQueryResults } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchQueryLogs')

const QueryLogsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  logGroupNames: z.array(z.string().min(1)).min(1, 'At least one log group name is required'),
  queryString: z.string().min(1, 'Query string is required'),
  startTime: z.number({ coerce: true }).int(),
  endTime: z.number({ coerce: true }).int(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.number({ coerce: true }).int().positive().optional()
  ),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = QueryLogsSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    logger.error('QueryLogs failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `CloudWatch Log Insights query failed: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
