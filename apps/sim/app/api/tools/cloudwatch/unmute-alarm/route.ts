import { CloudWatchClient, EnableAlarmActionsCommand } from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchUnmuteAlarmContract } from '@/lib/api/contracts/tools/aws/cloudwatch-unmute-alarm'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchUnmuteAlarm')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchUnmuteAlarmContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Unmuting ${validatedData.alarmNames.length} CloudWatch alarm(s)`)

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new EnableAlarmActionsCommand({
        AlarmNames: validatedData.alarmNames,
      })

      await client.send(command)

      logger.info(`Successfully unmuted ${validatedData.alarmNames.length} alarm(s)`)

      return NextResponse.json({
        success: true,
        output: {
          success: true,
          alarmNames: validatedData.alarmNames,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('UnmuteAlarm failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to unmute CloudWatch alarm: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
