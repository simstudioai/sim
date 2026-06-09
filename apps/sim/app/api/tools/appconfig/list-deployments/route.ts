import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigListDeploymentsContract } from '@/lib/api/contracts/tools/aws/appconfig-list-deployments'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, listDeployments } from '@/app/api/tools/appconfig/utils'

const logger = createLogger('AppConfigListDeploymentsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAppConfigListDeploymentsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    logger.info(`Listing deployments for environment '${data.environmentId}'`)

    const client = createAppConfigClient(data)
    try {
      const result = await listDeployments(client, {
        applicationId: data.applicationId,
        environmentId: data.environmentId,
        maxResults: data.maxResults ?? undefined,
        nextToken: data.nextToken ?? undefined,
      })
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'AppConfig list deployments failed'
    logger.error('AppConfig list deployments failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
