import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterGetUserContract } from '@/lib/api/contracts/tools/aws/identity-center-get-user'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIdentityStoreClient, getUserByEmail } from '../utils'

const logger = createLogger('IdentityCenterGetUserAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterGetUserContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Looking up user by email in identity store ${params.identityStoreId}`)

    const client = createIdentityStoreClient(params)
    try {
      const result = await getUserByEmail(client, params.identityStoreId, params.email)
      logger.info(`Successfully found user ${result.userId}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to get user:', error)
    return NextResponse.json(
      { error: `Failed to get user: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
