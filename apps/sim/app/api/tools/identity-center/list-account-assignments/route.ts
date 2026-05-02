import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterListAccountAssignmentsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-account-assignments'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSOAdminClient, listAccountAssignmentsForPrincipal } from '../utils'

const logger = createLogger('IdentityCenterListAccountAssignmentsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(
      awsIdentityCenterListAccountAssignmentsContract,
      request,
      {
        errorFormat: 'details',
        logger,
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Listing account assignments for ${params.principalType} ${params.principalId}`)

    const client = createSSOAdminClient(params)
    try {
      const result = await listAccountAssignmentsForPrincipal(
        client,
        params.instanceArn,
        params.principalId,
        params.principalType,
        params.maxResults,
        params.nextToken
      )
      logger.info(`Successfully listed ${result.count} account assignments`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to list account assignments:', error)
    return NextResponse.json(
      { error: `Failed to list account assignments: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
