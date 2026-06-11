import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigListHostedConfigurationVersionsContract } from '@/lib/api/contracts/tools/aws/appconfig-list-hosted-configuration-versions'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, listHostedConfigurationVersions } from '../utils'

const logger = createLogger('AppConfigListHostedConfigurationVersionsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(
      awsAppConfigListHostedConfigurationVersionsContract,
      request,
      { errorFormat: 'details', logger }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Listing AppConfig hosted configuration versions for profile ${params.configurationProfileId}`
    )

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listHostedConfigurationVersions(
        client,
        params.applicationId,
        params.configurationProfileId,
        params.maxResults,
        params.nextToken
      )
      logger.info(`[${requestId}] Listed ${result.count} hosted configuration versions`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to list hosted configuration versions:`, error)
    return NextResponse.json(
      { error: `Failed to list hosted configuration versions: ${errorMessage}` },
      { status: 500 }
    )
  }
})
