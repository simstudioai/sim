import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSecretsManagerRestoreSecretContract } from '@/lib/api/contracts/tools/aws/secrets-manager-restore-secret'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSecretsManagerClient, restoreSecret } from '../utils'

const logger = createLogger('SecretsManagerRestoreSecretAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSecretsManagerRestoreSecretContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Restoring secret ${params.secretId}`)

    const client = createSecretsManagerClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await restoreSecret(client, params.secretId)

      logger.info(`[${requestId}] Restored secret: ${result.name}`)

      return NextResponse.json({
        message: `Secret "${result.name}" restored successfully`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to restore secret:`, error)

    return NextResponse.json(
      { error: `Failed to restore secret: ${errorMessage}` },
      { status: 500 }
    )
  }
})
