import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigStopDeploymentContract } from '@/lib/api/contracts/tools/aws/appconfig-stop-deployment'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, stopDeployment } from '@/app/api/tools/appconfig/utils'

const logger = createLogger('AppConfigStopDeploymentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAppConfigStopDeploymentContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    logger.info(
      `Stopping deployment ${data.deploymentNumber} for environment '${data.environmentId}'`
    )

    const client = createAppConfigClient(data)
    try {
      const result = await stopDeployment(client, {
        applicationId: data.applicationId,
        environmentId: data.environmentId,
        deploymentNumber: data.deploymentNumber,
      })
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'AppConfig stop deployment failed'
    logger.error('AppConfig stop deployment failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
