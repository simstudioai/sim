import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSqsSendContract } from '@/lib/api/contracts/tools/aws/sqs-send'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSqsClient, sendMessage } from '../utils'

const logger = createLogger('SQSSendMessageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSqsSendContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Sending message to SQS queue ${params.queueUrl}`)

    const client = createSqsClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await sendMessage(
        client,
        params.queueUrl,
        params.data,
        params.messageGroupId,
        params.messageDeduplicationId
      )

      logger.info(`[${requestId}] Message sent to SQS queue ${params.queueUrl}`)

      return NextResponse.json({
        message: `Message sent to SQS queue ${params.queueUrl}`,
        id: result?.id,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SQS send message failed:`, error)

    return NextResponse.json({ error: `SQS send message failed: ${errorMessage}` }, { status: 500 })
  }
})
