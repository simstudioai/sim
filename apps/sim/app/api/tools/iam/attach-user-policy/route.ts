import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamAttachUserPolicyContract } from '@/lib/api/contracts/tools/aws/iam-attach-user-policy'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { attachUserPolicy, createIAMClient } from '../utils'

const logger = createLogger('IAMAttachUserPolicyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamAttachUserPolicyContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Attaching policy to IAM user "${params.userName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await attachUserPolicy(client, params.userName, params.policyArn)
      logger.info(`Successfully attached policy to IAM user "${params.userName}"`)
      return NextResponse.json({
        message: `Policy "${params.policyArn}" attached to user "${params.userName}"`,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to attach user policy:`, error)
    return NextResponse.json(
      { error: `Failed to attach user policy: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
