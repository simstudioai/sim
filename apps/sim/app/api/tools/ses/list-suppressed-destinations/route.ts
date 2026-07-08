import type { SuppressionListReason } from '@aws-sdk/client-sesv2'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesListSuppressedDestinationsContract } from '@/lib/api/contracts/tools/aws/ses-list-suppressed-destinations'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, listSuppressedDestinations } from '../utils'

const logger = createLogger('SESListSuppressedDestinationsAPI')

const VALID_SUPPRESSION_REASONS: SuppressionListReason[] = ['BOUNCE', 'COMPLAINT']

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesListSuppressedDestinationsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    let reasons: SuppressionListReason[] | null = null
    if (params.reasons) {
      const candidates = params.reasons
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
      const invalid = candidates.filter(
        (r) => !VALID_SUPPRESSION_REASONS.includes(r as SuppressionListReason)
      )
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error: `Invalid suppression reason(s): ${invalid.join(', ')}. Must be one of: ${VALID_SUPPRESSION_REASONS.join(', ')}`,
          },
          { status: 400 }
        )
      }
      reasons = candidates as SuppressionListReason[]
    }

    logger.info('Listing SES suppressed destinations')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listSuppressedDestinations(client, {
        reasons,
        startDate: params.startDate ? new Date(params.startDate) : null,
        endDate: params.endDate ? new Date(params.endDate) : null,
        pageSize: params.pageSize,
        nextToken: params.nextToken,
      })

      logger.info(`Listed ${result.count} suppressed destinations`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to list suppressed destinations:', error)

    return NextResponse.json(
      { error: `Failed to list suppressed destinations: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
