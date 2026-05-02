import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesSendEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-email'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, sendEmail } from '../utils'

const logger = createLogger('SESSendEmailAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesSendEmailContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const toList = params.toAddresses
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    logger.info(`Sending email from ${params.fromAddress} to ${toList.length} recipient(s)`)

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await sendEmail(client, {
        fromAddress: params.fromAddress,
        toAddresses: toList,
        subject: params.subject,
        bodyText: params.bodyText,
        bodyHtml: params.bodyHtml,
        ccAddresses: params.ccAddresses
          ? params.ccAddresses
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
        bccAddresses: params.bccAddresses
          ? params.bccAddresses
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
        replyToAddresses: params.replyToAddresses
          ? params.replyToAddresses
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
        configurationSetName: params.configurationSetName,
      })

      logger.info(`Email sent successfully, messageId: ${result.messageId}`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to send email:', error)

    return NextResponse.json(
      { error: `Failed to send email: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
