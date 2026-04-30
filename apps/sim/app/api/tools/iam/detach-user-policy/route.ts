import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamDetachUserPolicyContract } from '@/lib/api/contracts/tools/aws/iam-detach-user-policy'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, detachUserPolicy } from '../utils'

const logger = createLogger('IAMDetachUserPolicyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamDetachUserPolicyContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Detaching policy from IAM user "${params.userName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await detachUserPolicy(client, params.userName, params.policyArn)
      logger.info(`Successfully detached policy from IAM user "${params.userName}"`)
      return NextResponse.json({
        message: `Policy "${params.policyArn}" detached from user "${params.userName}"`,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to detach user policy:`, error)
    return NextResponse.json(
      { error: `Failed to detach user policy: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
