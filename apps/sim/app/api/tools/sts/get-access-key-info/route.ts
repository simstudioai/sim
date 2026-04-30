import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsStsGetAccessKeyInfoContract } from '@/lib/api/contracts/tools/aws/sts-get-access-key-info'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSTSClient, getAccessKeyInfo } from '../utils'

const logger = createLogger('STSGetAccessKeyInfoAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsStsGetAccessKeyInfoContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Getting access key info for ${params.targetAccessKeyId}`)

    const client = createSTSClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await getAccessKeyInfo(client, params.targetAccessKeyId)

      logger.info('Access key info retrieved successfully')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to get access key info', { error: toError(error).message })

    return NextResponse.json(
      { error: `Failed to get access key info: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
