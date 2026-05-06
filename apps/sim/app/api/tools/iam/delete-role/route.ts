import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamDeleteRoleContract } from '@/lib/api/contracts/tools/aws/iam-delete-role'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, deleteRole } from '../utils'

const logger = createLogger('IAMDeleteRoleAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamDeleteRoleContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Deleting IAM role "${params.roleName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await deleteRole(client, params.roleName)
      logger.info(`Successfully deleted IAM role "${params.roleName}"`)
      return NextResponse.json({ message: `Role "${params.roleName}" deleted successfully` })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to delete IAM role:`, error)
    return NextResponse.json(
      { error: `Failed to delete IAM role: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
