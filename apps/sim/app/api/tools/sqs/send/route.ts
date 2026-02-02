import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createSqsClient, sendMessage } from '../utils'

const logger = createLogger('SQSSendMessageAPI')

const SendMessageSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queueUrl: z.string().min(1, 'Queue URL is required'),
  messageGroupId: z.string().nullish(),
  messageDeduplicationId: z.string().nullish(),
  data: z.record(z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Data object must have at least one field',
  }),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = SendMessageSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] SQS send message failed:`, error)

    return NextResponse.json({ error: `SQS send message failed: ${errorMessage}` }, { status: 500 })
  }
}
