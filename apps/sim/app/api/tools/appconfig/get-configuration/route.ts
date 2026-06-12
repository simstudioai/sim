import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigGetConfigurationContract } from '@/lib/api/contracts/tools/aws/appconfig-get-configuration'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigDataClient, getConfiguration } from '../utils'

const logger = createLogger('AppConfigGetConfigurationAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsAppConfigGetConfigurationContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Retrieving AppConfig configuration for ${params.applicationId}/${params.environmentId}/${params.configurationProfileId}`
    )

    const client = createAppConfigDataClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await getConfiguration(
        client,
        params.applicationId,
        params.environmentId,
        params.configurationProfileId
      )
      logger.info(`[${requestId}] Retrieved configuration`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to retrieve configuration:`, error)
    return NextResponse.json(
      { error: `Failed to retrieve configuration: ${errorMessage}` },
      { status: 500 }
    )
  }
})
