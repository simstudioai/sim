import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterListAccountsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-accounts'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createOrganizationsClient, listAccounts } from '../utils'

const logger = createLogger('IdentityCenterListAccountsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterListAccountsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Listing AWS accounts')

    const client = createOrganizationsClient(params)
    try {
      const result = await listAccounts(client, params.maxResults, params.nextToken)
      logger.info(`Successfully listed ${result.count} accounts`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to list AWS accounts:', error)
    return NextResponse.json(
      { error: `Failed to list AWS accounts: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
