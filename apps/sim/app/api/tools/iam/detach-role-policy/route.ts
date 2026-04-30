import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamDetachRolePolicyContract } from '@/lib/api/contracts/tools/aws/iam-detach-role-policy'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, detachRolePolicy } from '../utils'

const logger = createLogger('IAMDetachRolePolicyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamDetachRolePolicyContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Detaching policy from IAM role "${params.roleName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await detachRolePolicy(client, params.roleName, params.policyArn)
      logger.info(`Successfully detached policy from IAM role "${params.roleName}"`)
      return NextResponse.json({
        message: `Policy "${params.policyArn}" detached from role "${params.roleName}"`,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to detach role policy:`, error)
    return NextResponse.json(
      { error: `Failed to detach role policy: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
