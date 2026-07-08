import {
  DeleteRetentionPolicyCommand,
  PutRetentionPolicyCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchPutLogGroupRetentionContract } from '@/lib/api/contracts/tools/aws/cloudwatch-put-log-group-retention'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchPutLogGroupRetention')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchPutLogGroupRetentionContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      if (validatedData.retentionInDays !== undefined) {
        logger.info(
          `Setting retention for log group "${validatedData.logGroupName}" to ${validatedData.retentionInDays} days`
        )
        await client.send(
          new PutRetentionPolicyCommand({
            logGroupName: validatedData.logGroupName,
            retentionInDays: validatedData.retentionInDays,
          })
        )
      } else {
        logger.info(
          `Removing retention policy for log group "${validatedData.logGroupName}" (events never expire)`
        )
        await client.send(
          new DeleteRetentionPolicyCommand({ logGroupName: validatedData.logGroupName })
        )
      }

      return NextResponse.json({
        success: true,
        output: {
          success: true,
          logGroupName: validatedData.logGroupName,
          retentionInDays: validatedData.retentionInDays ?? null,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('PutLogGroupRetention failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to set CloudWatch log group retention: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
