import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterDescribeAccountContract } from '@/lib/api/contracts/tools/aws/identity-center-describe-account'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createOrganizationsClient, describeAccount } from '../utils'

const logger = createLogger('IdentityCenterDescribeAccountAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterDescribeAccountContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Describing AWS account ${params.accountId}`)

    const client = createOrganizationsClient(params)
    try {
      const result = await describeAccount(client, params.accountId)
      logger.info(`Successfully described account ${result.name}`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to describe account:', error)
    return NextResponse.json(
      { error: `Failed to describe account: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
