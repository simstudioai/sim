import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamListUsersContract } from '@/lib/api/contracts/tools/aws/iam-list-users'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, listUsers } from '../utils'

const logger = createLogger('IAMListUsersAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamListUsersContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Listing IAM users`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listUsers(client, params.pathPrefix, params.maxItems, params.marker)
      logger.info(`Successfully listed ${result.count} IAM users`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to list IAM users:`, error)
    return NextResponse.json(
      { error: `Failed to list IAM users: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
