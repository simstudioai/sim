import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIdentityStoreClient, getUserByEmail } from '../utils'

const logger = createLogger('IdentityCenterGetUserAPI')

const Schema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  identityStoreId: z.string().min(1, 'Identity Store ID is required'),
  email: z.string().email('Valid email address is required'),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = Schema.parse(body)

    logger.info(`Looking up user by email in identity store ${params.identityStoreId}`)

    const client = createIdentityStoreClient(params)
    try {
      const result = await getUserByEmail(client, params.identityStoreId, params.email)
      logger.info(`Successfully found user ${result.userId}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    logger.error('Failed to get user:', error)
    return NextResponse.json(
      { error: `Failed to get user: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
