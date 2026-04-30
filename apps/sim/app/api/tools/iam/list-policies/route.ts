import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamListPoliciesContract } from '@/lib/api/contracts/tools/aws/iam-list-policies'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, listPolicies } from '../utils'

const logger = createLogger('IAMListPoliciesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamListPoliciesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Listing IAM policies`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listPolicies(
        client,
        params.scope,
        params.onlyAttached,
        params.pathPrefix,
        params.maxItems,
        params.marker
      )
      logger.info(`Successfully listed ${result.count} IAM policies`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to list IAM policies:`, error)
    return NextResponse.json(
      { error: `Failed to list IAM policies: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
