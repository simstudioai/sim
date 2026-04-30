import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterListGroupsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-groups'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIdentityStoreClient, listGroups } from '../utils'

const logger = createLogger('IdentityCenterListGroupsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterListGroupsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Listing groups in identity store ${params.identityStoreId}`)

    const client = createIdentityStoreClient(params)
    try {
      const result = await listGroups(
        client,
        params.identityStoreId,
        params.maxResults,
        params.nextToken
      )
      logger.info(`Successfully listed ${result.count} groups`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to list groups:', error)
    return NextResponse.json(
      { error: `Failed to list groups: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
