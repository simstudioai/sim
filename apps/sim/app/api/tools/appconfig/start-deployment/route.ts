import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigStartDeploymentContract } from '@/lib/api/contracts/tools/aws/appconfig-start-deployment'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, startDeployment } from '@/app/api/tools/appconfig/utils'

const logger = createLogger('AppConfigStartDeploymentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAppConfigStartDeploymentContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    logger.info(
      `Starting deployment to environment '${data.environmentId}' (version ${data.configurationVersion})`
    )

    const client = createAppConfigClient(data)
    try {
      const result = await startDeployment(client, {
        applicationId: data.applicationId,
        environmentId: data.environmentId,
        deploymentStrategyId: data.deploymentStrategyId,
        configurationProfileId: data.configurationProfileId,
        configurationVersion: data.configurationVersion,
        description: data.description ?? undefined,
      })
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'AppConfig start deployment failed'
    logger.error('AppConfig start deployment failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
