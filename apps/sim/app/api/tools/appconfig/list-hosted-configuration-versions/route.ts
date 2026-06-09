import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigListHostedConfigurationVersionsContract } from '@/lib/api/contracts/tools/aws/appconfig-list-hosted-configuration-versions'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createAppConfigClient,
  listHostedConfigurationVersions,
} from '@/app/api/tools/appconfig/utils'

const logger = createLogger('AppConfigListHostedConfigurationVersionsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(
      awsAppConfigListHostedConfigurationVersionsContract,
      request,
      { errorFormat: 'details', logger }
    )
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    logger.info(
      `Listing hosted configuration versions for profile '${data.configurationProfileId}'`
    )

    const client = createAppConfigClient(data)
    try {
      const result = await listHostedConfigurationVersions(client, {
        applicationId: data.applicationId,
        configurationProfileId: data.configurationProfileId,
        maxResults: data.maxResults ?? undefined,
        nextToken: data.nextToken ?? undefined,
      })
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage =
      toError(error).message || 'AppConfig list hosted configuration versions failed'
    logger.error('AppConfig list hosted configuration versions failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
