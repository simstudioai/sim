import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSecretsManagerRotateSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-rotate-secret'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSecretsManagerClient, rotateSecret } from '../utils'

const logger = createLogger('SecretsManagerRotateSecretAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSecretsManagerRotateSecretContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Rotating secret ${params.secretId}`)

    const client = createSecretsManagerClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await rotateSecret(
        client,
        params.secretId,
        params.clientRequestToken,
        params.rotationLambdaARN,
        {
          automaticallyAfterDays: params.automaticallyAfterDays,
          duration: params.duration,
          scheduleExpression: params.scheduleExpression,
        },
        params.rotateImmediately
      )

      logger.info(`[${requestId}] Rotation started for secret: ${result.name}`)

      return NextResponse.json({
        message: `Rotation started for secret "${result.name}"`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to rotate secret:`, error)

    return NextResponse.json({ error: `Failed to rotate secret: ${errorMessage}` }, { status: 500 })
  }
})
