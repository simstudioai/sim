import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesPutSuppressedDestinationContract } from '@/lib/api/contracts/tools/aws/ses-put-suppressed-destination'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, putSuppressedDestination } from '../utils'

const logger = createLogger('SESPutSuppressedDestinationAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesPutSuppressedDestinationContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Adding email address to SES suppression list')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await putSuppressedDestination(client, {
        emailAddress: params.emailAddress,
        reason: params.reason,
      })

      logger.info('Added email address to suppression list')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to add suppressed destination:', error)

    return NextResponse.json(
      { error: `Failed to add suppressed destination: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
