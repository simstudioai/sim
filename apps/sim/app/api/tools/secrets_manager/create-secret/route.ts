import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSecretsManagerCreateSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-create-secret'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSecret, createSecretsManagerClient } from '../utils'

const logger = createLogger('SecretsManagerCreateSecretAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSecretsManagerCreateSecretContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Creating secret ${params.name}`)

    const client = createSecretsManagerClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createSecret(client, params.name, params.secretValue, params.description)

      logger.info(`[${requestId}] Secret created: ${result.name}`)

      return NextResponse.json({
        message: `Secret "${result.name}" created successfully`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to create secret:`, error)

    return NextResponse.json({ error: `Failed to create secret: ${errorMessage}` }, { status: 500 })
  }
})
