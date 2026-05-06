import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamAddUserToGroupContract } from '@/lib/api/contracts/tools/aws/iam-add-user-to-group'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { addUserToGroup, createIAMClient } from '../utils'

const logger = createLogger('IAMAddUserToGroupAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamAddUserToGroupContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Adding user "${params.userName}" to group "${params.groupName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await addUserToGroup(client, params.userName, params.groupName)
      logger.info(`Successfully added user "${params.userName}" to group "${params.groupName}"`)
      return NextResponse.json({
        message: `User "${params.userName}" added to group "${params.groupName}"`,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to add user to group:`, error)
    return NextResponse.json(
      { error: `Failed to add user to group: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
