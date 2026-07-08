import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesGetSuppressedDestinationContract } from '@/lib/api/contracts/tools/aws/ses-get-suppressed-destination'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, getSuppressedDestination } from '../utils'

const logger = createLogger('SESGetSuppressedDestinationAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesGetSuppressedDestinationContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Fetching SES suppressed destination')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await getSuppressedDestination(client, params.emailAddress)

      logger.info('Fetched suppressed destination')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to get suppressed destination:', error)

    return NextResponse.json(
      { error: `Failed to get suppressed destination: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
