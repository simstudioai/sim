import {
  type AlarmType,
  CloudWatchClient,
  DescribeAlarmHistoryCommand,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchDescribeAlarmHistoryContract } from '@/lib/api/contracts/tools/aws/cloudwatch-describe-alarm-history'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchDescribeAlarmHistory')

/** AWS DescribeAlarmHistory caps `MaxRecords` at 100 items per page. */
const ALARM_HISTORY_PAGE_SIZE = 100

/** Upper bound on pages drained to avoid unbounded loops on long-lived alarms. */
const MAX_ALARM_HISTORY_PAGES = 20

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchDescribeAlarmHistoryContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Describing CloudWatch alarm history')

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const totalLimit = validatedData.limit
      const alarmHistoryItems: {
        alarmName: string | undefined
        alarmType: string | undefined
        timestamp: number | undefined
        historyItemType: string | undefined
        historySummary: string | undefined
      }[] = []
      let nextToken: string | undefined

      for (let page = 0; page < MAX_ALARM_HISTORY_PAGES; page++) {
        const pageLimit =
          totalLimit !== undefined
            ? Math.min(ALARM_HISTORY_PAGE_SIZE, totalLimit - alarmHistoryItems.length)
            : ALARM_HISTORY_PAGE_SIZE

        const command = new DescribeAlarmHistoryCommand({
          ...(validatedData.alarmName && { AlarmName: validatedData.alarmName }),
          // AWS defaults AlarmTypes to MetricAlarm-only, so always request both kinds explicitly.
          AlarmTypes: ['MetricAlarm', 'CompositeAlarm'] as AlarmType[],
          ...(validatedData.historyItemType && {
            HistoryItemType: validatedData.historyItemType,
          }),
          ...(validatedData.startDate !== undefined && {
            StartDate: new Date(validatedData.startDate * 1000),
          }),
          ...(validatedData.endDate !== undefined && {
            EndDate: new Date(validatedData.endDate * 1000),
          }),
          ScanBy: validatedData.scanBy ?? 'TimestampDescending',
          MaxRecords: pageLimit,
          ...(nextToken && { NextToken: nextToken }),
        })

        const response = await client.send(command)

        for (const item of response.AlarmHistoryItems ?? []) {
          alarmHistoryItems.push({
            alarmName: item.AlarmName,
            alarmType: item.AlarmType,
            timestamp: item.Timestamp?.getTime(),
            historyItemType: item.HistoryItemType,
            historySummary: item.HistorySummary,
          })
        }

        nextToken = response.NextToken
        if (!nextToken) break
        if (totalLimit !== undefined && alarmHistoryItems.length >= totalLimit) break

        if (page === MAX_ALARM_HISTORY_PAGES - 1) {
          logger.warn(
            `DescribeAlarmHistory hit pagination cap of ${MAX_ALARM_HISTORY_PAGES} pages; history may be incomplete`
          )
        }
      }

      const cappedItems =
        totalLimit !== undefined ? alarmHistoryItems.slice(0, totalLimit) : alarmHistoryItems

      logger.info(`Successfully described ${cappedItems.length} alarm history items`)

      return NextResponse.json({
        success: true,
        output: { alarmHistoryItems: cappedItems },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('DescribeAlarmHistory failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch alarm history: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
