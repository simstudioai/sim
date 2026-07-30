import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesSendCustomVerificationEmailContract } from '@/lib/api/contracts/tools/aws/ses-send-custom-verification-email'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, sendCustomVerificationEmail } from '../utils'

const logger = createLogger('SESSendCustomVerificationEmailAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesSendCustomVerificationEmailContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Sending SES custom verification email')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await sendCustomVerificationEmail(client, {
        emailAddress: params.emailAddress,
        templateName: params.templateName,
        configurationSetName: params.configurationSetName,
      })

      logger.info(`Sent custom verification email to '${params.emailAddress}'`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to send custom verification email:', error)

    return NextResponse.json(
      { error: `Failed to send custom verification email: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
