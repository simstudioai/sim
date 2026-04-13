import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'
import { createIAMClient, createUser } from '../utils'

const logger = createLogger('IAMCreateUserAPI')

const Schema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  userName: z.string().min(1, 'User name is required'),
  path: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = Schema.parse(body)

    logger.info(`[${requestId}] Creating IAM user "${params.userName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createUser(client, params.userName, params.path)
      logger.info(`[${requestId}] Successfully created IAM user "${result.userName}"`)
      return NextResponse.json({
        message: `User "${result.userName}" created successfully`,
        ...result,
      })
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
    logger.error(`[${requestId}] Failed to create IAM user:`, error)
    return NextResponse.json(
      { error: `Failed to create IAM user: ${errorMessage}` },
      { status: 500 }
    )
  }
}
