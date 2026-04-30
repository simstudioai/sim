import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamDeleteAccessKeyContract } from '@/lib/api/contracts/tools/aws/iam-delete-access-key'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, deleteAccessKey } from '../utils'

const logger = createLogger('IAMDeleteAccessKeyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamDeleteAccessKeyContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Deleting IAM access key "${params.accessKeyIdToDelete}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await deleteAccessKey(client, params.accessKeyIdToDelete, params.userName)
      logger.info(`Successfully deleted access key "${params.accessKeyIdToDelete}"`)
      return NextResponse.json({ message: `Access key "${params.accessKeyIdToDelete}" deleted` })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to delete access key:`, error)
    return NextResponse.json(
      { error: `Failed to delete access key: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
