import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamCreateRoleContract } from '@/lib/api/contracts/tools/aws/iam-create-role'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, createRole } from '../utils'

const logger = createLogger('IAMCreateRoleAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamCreateRoleContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Creating IAM role "${params.roleName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createRole(
        client,
        params.roleName,
        params.assumeRolePolicyDocument,
        params.description,
        params.path,
        params.maxSessionDuration
      )
      logger.info(`Successfully created IAM role "${result.roleName}"`)
      return NextResponse.json({
        message: `Role "${result.roleName}" created successfully`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to create IAM role:`, error)
    return NextResponse.json(
      { error: `Failed to create IAM role: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
