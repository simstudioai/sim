import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'
import { createIAMClient, listUsers } from '../utils'

const logger = createLogger('IAMListUsersAPI')

const Schema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  pathPrefix: z.string().optional(),
  maxItems: z.number().min(1).max(1000).optional(),
  marker: z.string().optional(),
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

    logger.info(`[${requestId}] Listing IAM users`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listUsers(client, params.pathPrefix, params.maxItems, params.marker)
      logger.info(`[${requestId}] Successfully listed ${result.count} IAM users`)
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
    logger.error(`[${requestId}] Failed to list IAM users:`, error)
    return NextResponse.json(
      { error: `Failed to list IAM users: ${errorMessage}` },
      { status: 500 }
    )
  }
}
