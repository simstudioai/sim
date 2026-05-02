import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsStsGetSessionTokenContract } from '@/lib/api/contracts/tools/aws/sts-get-session-token'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSTSClient, getSessionToken } from '../utils'

const logger = createLogger('STSGetSessionTokenAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsStsGetSessionTokenContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Getting session token')

    const client = createSTSClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await getSessionToken(
        client,
        params.durationSeconds,
        params.serialNumber,
        params.tokenCode
      )

      logger.info('Session token retrieved successfully')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to get session token', { error: toError(error).message })

    return NextResponse.json(
      { error: `Failed to get session token: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
