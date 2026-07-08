import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSecretsManagerTagResourceContract } from '@/lib/api/contracts/tools/aws/secrets-manager-tag-resource'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSecretsManagerClient, tagResource } from '../utils'

const logger = createLogger('SecretsManagerTagResourceAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSecretsManagerTagResourceContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Tagging secret ${params.secretId}`)

    const client = createSecretsManagerClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await tagResource(
        client,
        params.secretId,
        params.tags.map((t) => ({ Key: t.key, Value: t.value }))
      )

      logger.info(`[${requestId}] Tagged secret: ${result.name}`)

      return NextResponse.json({
        message: `Secret "${result.name}" tagged successfully`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to tag secret:`, error)

    return NextResponse.json({ error: `Failed to tag secret: ${errorMessage}` }, { status: 500 })
  }
})
