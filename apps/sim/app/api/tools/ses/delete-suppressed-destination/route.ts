import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesDeleteSuppressedDestinationContract } from '@/lib/api/contracts/tools/aws/ses-delete-suppressed-destination'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, deleteSuppressedDestination } from '../utils'

const logger = createLogger('SESDeleteSuppressedDestinationAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesDeleteSuppressedDestinationContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Removing email address from SES suppression list')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await deleteSuppressedDestination(client, params.emailAddress)

      logger.info('Removed email address from suppression list')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to remove suppressed destination:', error)

    return NextResponse.json(
      { error: `Failed to remove suppressed destination: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
