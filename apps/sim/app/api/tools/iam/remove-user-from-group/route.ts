import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamRemoveUserFromGroupContract } from '@/lib/api/contracts/tools/aws/iam-remove-user-from-group'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, removeUserFromGroup } from '../utils'

const logger = createLogger('IAMRemoveUserFromGroupAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamRemoveUserFromGroupContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Removing user "${params.userName}" from group "${params.groupName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await removeUserFromGroup(client, params.userName, params.groupName)
      logger.info(`Successfully removed user "${params.userName}" from group "${params.groupName}"`)
      return NextResponse.json({
        message: `User "${params.userName}" removed from group "${params.groupName}"`,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to remove user from group:`, error)
    return NextResponse.json(
      { error: `Failed to remove user from group: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
