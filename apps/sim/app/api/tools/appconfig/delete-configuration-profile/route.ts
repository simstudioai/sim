import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigDeleteConfigurationProfileContract } from '@/lib/api/contracts/tools/aws/appconfig-delete-configuration-profile'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, deleteConfigurationProfile } from '../utils'

const logger = createLogger('AppConfigDeleteConfigurationProfileAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsAppConfigDeleteConfigurationProfileContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Deleting AppConfig configuration profile ${params.configurationProfileId}`
    )

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await deleteConfigurationProfile(
        client,
        params.applicationId,
        params.configurationProfileId
      )
      logger.info(`[${requestId}] Deleted configuration profile`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to delete configuration profile:`, error)
    return NextResponse.json(
      { error: `Failed to delete configuration profile: ${errorMessage}` },
      { status: 500 }
    )
  }
})
