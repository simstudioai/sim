import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsStsAssumeRoleWithWebIdentityContract } from '@/lib/api/contracts/tools/aws/sts-assume-role-with-web-identity'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assumeRoleWithWebIdentity, createUnauthenticatedSTSClient } from '../utils'

const logger = createLogger('STSAssumeRoleWithWebIdentityAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsStsAssumeRoleWithWebIdentityContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Assuming role ${params.roleArn} with web identity`)

    const client = createUnauthenticatedSTSClient(params.region)

    try {
      const result = await assumeRoleWithWebIdentity(
        client,
        params.roleArn,
        params.roleSessionName,
        params.webIdentityToken,
        params.providerId,
        params.policyArns,
        params.policy,
        params.durationSeconds
      )

      logger.info('Role assumed successfully with web identity')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to assume role with web identity', { error: toError(error).message })

    return NextResponse.json(
      { error: `Failed to assume role with web identity: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
