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

/** AWS DescribeLogGroups caps `limit` at 50 items per page. */
const LOG_GROUPS_PAGE_SIZE = 50

/** Upper bound on pages drained to avoid unbounded loops on very large accounts. */
const MAX_LOG_GROUPS_PAGES = 20

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
      const totalLimit = validatedData.limit
      const logGroups: {
        logGroupName: string
        arn: string
        storedBytes: number
        retentionInDays: number | undefined
        creationTime: number | undefined
      }[] = []
      let nextToken: string | undefined

      for (let page = 0; page < MAX_LOG_GROUPS_PAGES; page++) {
        const pageLimit =
          totalLimit !== undefined
            ? Math.min(LOG_GROUPS_PAGE_SIZE, totalLimit - logGroups.length)
            : LOG_GROUPS_PAGE_SIZE

        const command = new DescribeLogGroupsCommand({
          ...(validatedData.prefix && { logGroupNamePrefix: validatedData.prefix }),
          limit: pageLimit,
          ...(nextToken && { nextToken }),
        })

        const response = await client.send(command)

        for (const lg of response.logGroups ?? []) {
          logGroups.push({
            logGroupName: lg.logGroupName ?? '',
            arn: lg.arn ?? '',
            storedBytes: lg.storedBytes ?? 0,
            retentionInDays: lg.retentionInDays,
            creationTime: lg.creationTime,
          })
        }

        nextToken = response.nextToken
        if (!nextToken) break
        if (totalLimit !== undefined && logGroups.length >= totalLimit) break

        if (page === MAX_LOG_GROUPS_PAGES - 1) {
          logger.warn(
            `DescribeLogGroups hit pagination cap of ${MAX_LOG_GROUPS_PAGES} pages; log group list may be incomplete`
          )
        }
      }

      const cappedLogGroups = totalLimit !== undefined ? logGroups.slice(0, totalLimit) : logGroups

      logger.info(`Successfully described ${cappedLogGroups.length} log groups`)

      return NextResponse.json({
        success: true,
        output: { logGroups: cappedLogGroups },
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
