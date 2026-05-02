import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesSendBulkEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-bulk-email'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, parseBulkEmailDestinations, sendBulkEmail } from '../utils'

const logger = createLogger('SESSendBulkEmailAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesSendBulkEmailContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    let destinations: ReturnType<typeof parseBulkEmailDestinations>
    try {
      destinations = parseBulkEmailDestinations(params.destinations)
    } catch {
      return NextResponse.json(
        { error: 'destinations must be a valid JSON array of destination objects' },
        { status: 400 }
      )
    }

    logger.info(
      `Sending bulk email from ${params.fromAddress} to ${destinations.length} destination(s) using template '${params.templateName}'`
    )

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await sendBulkEmail(client, {
        fromAddress: params.fromAddress,
        templateName: params.templateName,
        destinations,
        defaultTemplateData: params.defaultTemplateData,
        configurationSetName: params.configurationSetName,
      })

      logger.info(
        `Bulk email sent: ${result.successCount} succeeded, ${result.failureCount} failed`
      )

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to send bulk email:', error)

    return NextResponse.json(
      { error: `Failed to send bulk email: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
