import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigCreateHostedConfigurationVersionContract } from '@/lib/api/contracts/tools/aws/appconfig-create-hosted-configuration-version'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createAppConfigClient,
  createHostedConfigurationVersion,
} from '@/app/api/tools/appconfig/utils'

const logger = createLogger('AppConfigCreateHostedConfigurationVersionAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(
      awsAppConfigCreateHostedConfigurationVersionContract,
      request,
      { errorFormat: 'details', logger }
    )
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    logger.info(
      `Creating hosted configuration version for profile '${data.configurationProfileId}'`
    )

    const client = createAppConfigClient(data)
    try {
      const result = await createHostedConfigurationVersion(client, {
        applicationId: data.applicationId,
        configurationProfileId: data.configurationProfileId,
        content: data.content,
        contentType: data.contentType,
        description: data.description ?? undefined,
        versionLabel: data.versionLabel ?? undefined,
        latestVersionNumber: data.latestVersionNumber ?? undefined,
      })
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage =
      toError(error).message || 'AppConfig create hosted configuration version failed'
    logger.error('AppConfig create hosted configuration version failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
