import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'
import { createSecretsManagerClient, deleteSecret } from '../utils'

const logger = createLogger('SecretsManagerDeleteSecretAPI')

const DeleteSecretSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  secretId: z.string().min(1, 'Secret ID is required'),
  recoveryWindowInDays: z.number().min(7).max(30).nullish(),
  forceDelete: z.boolean().nullish(),
})

export async function POST(request: NextRequest) {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = DeleteSecretSchema.parse(body)

    logger.info(`[${requestId}] Deleting secret ${params.secretId}`)

    const client = createSecretsManagerClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await deleteSecret(
        client,
        params.secretId,
        params.recoveryWindowInDays,
        params.forceDelete
      )

      const action = params.forceDelete ? 'permanently deleted' : 'scheduled for deletion'
      logger.info(`[${requestId}] Secret ${action}: ${result.name}`)

      return NextResponse.json({
        message: `Secret "${result.name}" ${action}`,
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
    logger.error(`[${requestId}] Failed to delete secret:`, error)

    return NextResponse.json({ error: `Failed to delete secret: ${errorMessage}` }, { status: 500 })
  }
}
