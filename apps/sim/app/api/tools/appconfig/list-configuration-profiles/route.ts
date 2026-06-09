import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAppConfigListConfigurationProfilesContract } from '@/lib/api/contracts/tools/aws/appconfig-list-configuration-profiles'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAppConfigClient, listConfigurationProfiles } from '@/app/api/tools/appconfig/utils'

const logger = createLogger('AppConfigListConfigurationProfilesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAppConfigListConfigurationProfilesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    logger.info(`Listing configuration profiles for application '${data.applicationId}'`)

    const client = createAppConfigClient(data)
    try {
      const result = await listConfigurationProfiles(client, {
        applicationId: data.applicationId,
        maxResults: data.maxResults ?? undefined,
        nextToken: data.nextToken ?? undefined,
      })
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'AppConfig list configuration profiles failed'
    logger.error('AppConfig list configuration profiles failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
