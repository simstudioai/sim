import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigCreateConfigurationProfileContract } from '@/lib/api/contracts/tools/aws/appconfig-create-configuration-profile'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, createConfigurationProfile } from '../utils'

const logger = createLogger('AppConfigCreateConfigurationProfileAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsAppConfigCreateConfigurationProfileContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Creating AppConfig configuration profile ${params.name}`)

    const client = createAppConfigClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createConfigurationProfile(
        client,
        params.applicationId,
        params.name,
        params.locationUri,
        params.description,
        params.retrievalRoleArn,
        params.type
      )
      logger.info(`[${requestId}] Created configuration profile ${result.id}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] Failed to create configuration profile:`, error)
    return NextResponse.json(
      { error: `Failed to create configuration profile: ${errorMessage}` },
      { status: 500 }
    )
  }
})
