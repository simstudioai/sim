import type { SuppressionListReason } from '@aws-sdk/client-sesv2'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesCreateConfigurationSetContract } from '@/lib/api/contracts/tools/aws/ses-create-configuration-set'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createConfigurationSet, createSESClient } from '../utils'

const logger = createLogger('SESCreateConfigurationSetAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesCreateConfigurationSetContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Creating SES configuration set')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const suppressedReasons = params.suppressedReasons
        ? (params.suppressedReasons
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean) as SuppressionListReason[])
        : null
      const tags = params.tags ? JSON.parse(params.tags) : null

      const result = await createConfigurationSet(client, {
        configurationSetName: params.configurationSetName,
        customRedirectDomain: params.customRedirectDomain,
        httpsPolicy: params.httpsPolicy,
        tlsPolicy: params.tlsPolicy,
        sendingPoolName: params.sendingPoolName,
        reputationMetricsEnabled: params.reputationMetricsEnabled,
        sendingEnabled: params.sendingEnabled,
        suppressedReasons,
        tags,
      })

      logger.info(`Created configuration set '${params.configurationSetName}'`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to create configuration set:', error)

    return NextResponse.json(
      { error: `Failed to create configuration set: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
