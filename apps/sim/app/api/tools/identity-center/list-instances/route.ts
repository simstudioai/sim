import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterListInstancesContract } from '@/lib/api/contracts/tools/aws/identity-center-list-instances'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSOAdminClient, listInstances } from '../utils'

const logger = createLogger('IdentityCenterListInstancesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterListInstancesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Listing Identity Center instances')

    const client = createSSOAdminClient(params)
    try {
      const result = await listInstances(client, params.maxResults, params.nextToken)
      logger.info(`Successfully listed ${result.count} instances`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to list Identity Center instances:', error)
    return NextResponse.json(
      { error: `Failed to list Identity Center instances: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
