import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigCreateHostedConfigurationVersionContract } from '@/lib/api/contracts/tools/aws/appconfig-create-hosted-configuration-version'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, createHostedConfigurationVersion } from '../utils'

const logger = createLogger('AppConfigCreateHostedConfigurationVersionAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(
      awsAppConfigCreateHostedConfigurationVersionContract,
      request,
      { errorFormat: 'details', logger }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Creating hosted configuration version for profile ${params.configurationProfileId}`
    )

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createHostedConfigurationVersion(
        client,
        params.applicationId,
        params.configurationProfileId,
        params.content,
        params.contentType,
        params.description,
        params.latestVersionNumber,
        params.versionLabel
      )
      logger.info(`[${requestId}] Created hosted configuration version ${result.versionNumber}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to create hosted configuration version:`, error)
    return NextResponse.json(
      { error: `Failed to create hosted configuration version: ${errorMessage}` },
      { status: 500 }
    )
  }
})
