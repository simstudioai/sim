import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigStartDeploymentContract } from '@/lib/api/contracts/tools/aws/appconfig-start-deployment'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, startDeployment } from '../utils'

const logger = createLogger('AppConfigStartDeploymentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsAppConfigStartDeploymentContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Starting AppConfig deployment in env ${params.environmentId}`)

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await startDeployment(
        client,
        params.applicationId,
        params.environmentId,
        params.deploymentStrategyId,
        params.configurationProfileId,
        params.configurationVersion,
        params.description
      )
      logger.info(`[${requestId}] Started deployment ${result.deploymentNumber}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to start deployment:`, error)
    return NextResponse.json(
      { error: `Failed to start deployment: ${errorMessage}` },
      { status: 500 }
    )
  }
})
