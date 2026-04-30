import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterGetGroupContract } from '@/lib/api/contracts/tools/aws/identity-center-get-group'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIdentityStoreClient, getGroupByDisplayName } from '../utils'

const logger = createLogger('IdentityCenterGetGroupAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterGetGroupContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `Looking up group "${params.displayName}" in identity store ${params.identityStoreId}`
    )

    const client = createIdentityStoreClient(params)
    try {
      const result = await getGroupByDisplayName(client, params.identityStoreId, params.displayName)
      logger.info(`Successfully found group ${result.groupId}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to get group:', error)
    return NextResponse.json(
      { error: `Failed to get group: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
