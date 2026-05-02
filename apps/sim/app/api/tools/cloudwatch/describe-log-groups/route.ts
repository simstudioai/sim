import { DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { cloudwatchLogGroupsSelectorContract } from '@/lib/api/contracts/selectors/cloudwatch'
import { parseToolRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient } from '@/app/api/tools/cloudwatch/utils'

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

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const command = new DescribeLogGroupsCommand({
        ...(validatedData.prefix && { logGroupNamePrefix: validatedData.prefix }),
        ...(validatedData.limit !== undefined && { limit: validatedData.limit }),
      })

      const response = await client.send(command)

      const logGroups = (response.logGroups ?? []).map((lg) => ({
        logGroupName: lg.logGroupName ?? '',
        arn: lg.arn ?? '',
        storedBytes: lg.storedBytes ?? 0,
        retentionInDays: lg.retentionInDays,
        creationTime: lg.creationTime,
      }))

      logger.info(`Successfully described ${logGroups.length} log groups`)

      return NextResponse.json({
        success: true,
        output: { logGroups },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('DescribeLogGroups failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch log groups: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
