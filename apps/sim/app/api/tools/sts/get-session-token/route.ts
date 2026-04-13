import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'
import { createSTSClient, getSessionToken } from '../utils'

const logger = createLogger('STSGetSessionTokenAPI')

const GetSessionTokenSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  durationSeconds: z.number().int().min(900).max(129600).nullish(),
  serialNumber: z.string().nullish(),
  tokenCode: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = GetSessionTokenSchema.parse(body)

    logger.info(`[${requestId}] Getting session token`)

    const client = createSTSClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await getSessionToken(
        client,
        params.durationSeconds,
        params.serialNumber,
        params.tokenCode
      )

      logger.info(`[${requestId}] Session token retrieved successfully`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] Failed to get session token:`, error)

    return NextResponse.json(
      { error: `Failed to get session token: ${errorMessage}` },
      { status: 500 }
    )
  }
}
