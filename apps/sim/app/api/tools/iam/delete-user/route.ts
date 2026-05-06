import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamDeleteUserContract } from '@/lib/api/contracts/tools/aws/iam-delete-user'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, deleteUser } from '../utils'

const logger = createLogger('IAMDeleteUserAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamDeleteUserContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Deleting IAM user "${params.userName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await deleteUser(client, params.userName)
      logger.info(`Successfully deleted IAM user "${params.userName}"`)
      return NextResponse.json({ message: `User "${params.userName}" deleted successfully` })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to delete IAM user:`, error)
    return NextResponse.json(
      { error: `Failed to delete IAM user: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
