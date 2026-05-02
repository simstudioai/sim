import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterListPermissionSetsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-permission-sets'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSOAdminClient, listPermissionSets } from '../utils'

const logger = createLogger('IdentityCenterListPermissionSetsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterListPermissionSetsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Listing permission sets for instance ${params.instanceArn}`)

    const client = createSSOAdminClient(params)
    try {
      const result = await listPermissionSets(
        client,
        params.instanceArn,
        params.maxResults,
        params.nextToken
      )
      logger.info(`Successfully listed ${result.count} permission sets`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to list permission sets:', error)
    return NextResponse.json(
      { error: `Failed to list permission sets: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
