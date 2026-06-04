import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamAttachRolePolicyContract } from '@/lib/api/contracts/tools/aws/iam-attach-role-policy'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { attachRolePolicy, createIAMClient } from '../utils'

const logger = createLogger('IAMAttachRolePolicyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamAttachRolePolicyContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Attaching policy to IAM role "${params.roleName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await attachRolePolicy(client, params.roleName, params.policyArn)
      logger.info(`Successfully attached policy to IAM role "${params.roleName}"`)
      return NextResponse.json({
        message: `Policy "${params.policyArn}" attached to role "${params.roleName}"`,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to attach role policy:`, error)
    return NextResponse.json(
      { error: `Failed to attach role policy: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
