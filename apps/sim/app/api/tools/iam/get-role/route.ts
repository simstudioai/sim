import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamGetRoleContract } from '@/lib/api/contracts/tools/aws/iam-get-role'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, getRole } from '../utils'

const logger = createLogger('IAMGetRoleAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamGetRoleContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Getting IAM role "${params.roleName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await getRole(client, params.roleName)
      logger.info(`Successfully retrieved IAM role "${params.roleName}"`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to get IAM role:`, error)
    return NextResponse.json(
      { error: `Failed to get IAM role: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
