import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsStsAssumeRoleWithSAMLContract } from '@/lib/api/contracts/tools/aws/sts-assume-role-with-saml'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assumeRoleWithSAML, createUnauthenticatedSTSClient } from '../utils'

const logger = createLogger('STSAssumeRoleWithSAMLAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsStsAssumeRoleWithSAMLContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Assuming role ${params.roleArn} with SAML`)

    const client = createUnauthenticatedSTSClient(params.region)

    try {
      const result = await assumeRoleWithSAML(
        client,
        params.roleArn,
        params.principalArn,
        params.samlAssertion,
        params.policyArns,
        params.policy,
        params.durationSeconds
      )

      logger.info('Role assumed successfully with SAML')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to assume role with SAML', { error: toError(error).message })

    return NextResponse.json(
      { error: `Failed to assume role with SAML: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
