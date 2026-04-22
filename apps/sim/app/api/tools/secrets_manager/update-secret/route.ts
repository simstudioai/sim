import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSecretsManagerClient, updateSecretValue } from '../utils'

const logger = createLogger('SecretsManagerUpdateSecretAPI')

const UpdateSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  secretValue: z.string().min(1, 'Secret value is required'),
  description: z.string().nullish(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = UpdateSecretSchema.parse(body)

    logger.info(`[${requestId}] Updating secret ${params.secretId}`)

    const client = createSecretsManagerClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await updateSecretValue(
        client,
        params.secretId,
        params.secretValue,
        params.description
      )

      logger.info(`[${requestId}] Secret updated: ${result.name}`)

      return NextResponse.json({
        message: `Secret "${result.name}" updated successfully`,
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
    logger.error(`[${requestId}] Failed to update secret:`, error)

    return NextResponse.json({ error: `Failed to update secret: ${errorMessage}` }, { status: 500 })
  }
})
