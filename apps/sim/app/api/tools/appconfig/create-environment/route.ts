import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigCreateEnvironmentContract } from '@/lib/api/contracts/tools/aws/appconfig-create-environment'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, createEnvironment } from '../utils'

const logger = createLogger('AppConfigCreateEnvironmentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsAppConfigCreateEnvironmentContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Creating AppConfig environment ${params.name}`)

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createEnvironment(
        client,
        params.applicationId,
        params.name,
        params.description
      )
      logger.info(`[${requestId}] Created environment ${result.id}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to create environment:`, error)
    return NextResponse.json(
      { error: `Failed to create environment: ${errorMessage}` },
      { status: 500 }
    )
  }
})
