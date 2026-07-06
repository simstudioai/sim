import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesCreateEmailIdentityContract } from '@/lib/api/contracts/tools/aws/ses-create-email-identity'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createEmailIdentity, createSESClient } from '../utils'

const logger = createLogger('SESCreateEmailIdentityAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesCreateEmailIdentityContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Creating SES email identity')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const dkimSigningAttributes = params.dkimSigningAttributes
        ? JSON.parse(params.dkimSigningAttributes)
        : null
      const tags = params.tags ? JSON.parse(params.tags) : null

      const result = await createEmailIdentity(client, {
        emailIdentity: params.emailIdentity,
        dkimSigningAttributes,
        tags,
        configurationSetName: params.configurationSetName,
      })

      logger.info(`Created email identity '${params.emailIdentity}'`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to create email identity:', error)

    return NextResponse.json(
      { error: `Failed to create email identity: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
