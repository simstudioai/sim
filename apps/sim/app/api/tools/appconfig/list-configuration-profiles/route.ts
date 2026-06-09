import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigListConfigurationProfilesContract } from '@/lib/api/contracts/tools/aws/appconfig-list-configuration-profiles'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, listConfigurationProfiles } from '../utils'

const logger = createLogger('AppConfigListConfigurationProfilesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsAppConfigListConfigurationProfilesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Listing AppConfig configuration profiles for ${params.applicationId}`
    )

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listConfigurationProfiles(
        client,
        params.applicationId,
        params.maxResults,
        params.nextToken
      )
      logger.info(`[${requestId}] Listed ${result.count} configuration profiles`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to list configuration profiles:`, error)
    return NextResponse.json(
      { error: `Failed to list configuration profiles: ${errorMessage}` },
      { status: 500 }
    )
  }
})
