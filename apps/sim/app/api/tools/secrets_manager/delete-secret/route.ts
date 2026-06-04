import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSecretsManagerDeleteSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-delete-secret'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSecretsManagerClient, deleteSecret } from '../utils'

const logger = createLogger('SecretsManagerDeleteSecretAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSecretsManagerDeleteSecretContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

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
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to delete secret:`, error)

    return NextResponse.json({ error: `Failed to delete secret: ${errorMessage}` }, { status: 500 })
  }
})
