import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigListDeploymentStrategiesContract } from '@/lib/api/contracts/tools/aws/appconfig-list-deployment-strategies'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, listDeploymentStrategies } from '@/app/api/tools/appconfig/utils'

const logger = createLogger('AppConfigListDeploymentStrategiesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAppConfigListDeploymentStrategiesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    logger.info('Listing AppConfig deployment strategies')

    const client = createAppConfigClient(data)
    try {
      const result = await listDeploymentStrategies(client, {
        maxResults: data.maxResults ?? undefined,
        nextToken: data.nextToken ?? undefined,
      })
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'AppConfig list deployment strategies failed'
    logger.error('AppConfig list deployment strategies failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
