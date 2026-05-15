import { CloudWatchClient, PutAlarmMuteRuleCommand } from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchMuteAlarmContract } from '@/lib/api/contracts/tools/aws/cloudwatch-mute-alarm'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudWatchMuteAlarm')

function toAtExpression(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const min = String(date.getUTCMinutes()).padStart(2, '0')
  return `at(${yyyy}-${mm}-${dd}T${hh}:${min})`
}

function toIsoDuration(value: number, unit: 'minutes' | 'hours' | 'days'): string {
  switch (unit) {
    case 'minutes':
      return `PT${value}M`
    case 'hours':
      return `PT${value}H`
    case 'days':
      return `P${value}D`
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchMuteAlarmContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const startDate =
      validatedData.startDate !== undefined ? new Date(validatedData.startDate * 1000) : new Date()
    const expression = toAtExpression(startDate)
    const duration = toIsoDuration(validatedData.durationValue, validatedData.durationUnit)

    logger.info(
      `Creating CloudWatch alarm mute rule "${validatedData.muteRuleName}" for ${validatedData.alarmNames.length} alarm(s) (${expression}, duration ${duration})`
    )

    const client = new CloudWatchClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new PutAlarmMuteRuleCommand({
        Name: validatedData.muteRuleName,
        ...(validatedData.description && { Description: validatedData.description }),
        Rule: {
          Schedule: {
            Expression: expression,
            Duration: duration,
          },
        },
        MuteTargets: { AlarmNames: validatedData.alarmNames },
      })

      await client.send(command)

      logger.info(`Successfully created mute rule "${validatedData.muteRuleName}"`)

      return NextResponse.json({
        success: true,
        output: {
          success: true,
          muteRuleName: validatedData.muteRuleName,
          alarmNames: validatedData.alarmNames,
          expression,
          duration,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('MuteAlarm failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to create CloudWatch alarm mute rule: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
