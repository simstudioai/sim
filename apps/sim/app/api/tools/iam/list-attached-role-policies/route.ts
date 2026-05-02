import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamListAttachedRolePoliciesContract } from '@/lib/api/contracts/tools/aws/iam-list-attached-role-policies'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, listAttachedRolePolicies } from '../utils'

const logger = createLogger('IAMListAttachedRolePoliciesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamListAttachedRolePoliciesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Listing policies attached to IAM role "${params.roleName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listAttachedRolePolicies(
        client,
        params.roleName,
        params.pathPrefix,
        params.maxItems,
        params.marker
      )
      logger.info(`Found ${result.count} policies attached to role "${params.roleName}"`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to list attached role policies:`, error)
    return NextResponse.json(
      { error: `Failed to list attached role policies: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
