import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesDeleteEmailIdentityContract } from '@/lib/api/contracts/tools/aws/ses-delete-email-identity'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, deleteEmailIdentity } from '../utils'

const logger = createLogger('SESDeleteEmailIdentityAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesDeleteEmailIdentityContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Deleting SES email identity')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await deleteEmailIdentity(client, params.emailIdentity)

      logger.info(`Deleted email identity '${params.emailIdentity}'`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to delete email identity:', error)

    return NextResponse.json(
      { error: `Failed to delete email identity: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
