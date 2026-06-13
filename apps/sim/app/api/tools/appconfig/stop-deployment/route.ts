import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigStopDeploymentContract } from '@/lib/api/contracts/tools/aws/appconfig-stop-deployment'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, stopDeployment } from '../utils'

const logger = createLogger('AppConfigStopDeploymentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsAppConfigStopDeploymentContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Stopping AppConfig deployment ${params.deploymentNumber} in env ${params.environmentId}`
    )

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await stopDeployment(
        client,
        params.applicationId,
        params.environmentId,
        params.deploymentNumber
      )
      logger.info(`[${requestId}] Stopped deployment ${result.deploymentNumber}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to stop deployment:`, error)
    return NextResponse.json(
      { error: `Failed to stop deployment: ${errorMessage}` },
      { status: 500 }
    )
  }
})
