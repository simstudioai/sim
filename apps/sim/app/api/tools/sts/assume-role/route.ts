import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsStsAssumeRoleContract } from '@/lib/api/contracts/tools/aws/sts-assume-role'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assumeRole, createSTSClient } from '../utils'

const logger = createLogger('STSAssumeRoleAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsStsAssumeRoleContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Assuming role ${params.roleArn}`)

    const client = createSTSClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await assumeRole(
        client,
        params.roleArn,
        params.roleSessionName,
        params.durationSeconds,
        params.policy,
        params.externalId,
        params.serialNumber,
        params.tokenCode
      )

      logger.info('Role assumed successfully')

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to assume role', { error: toError(error).message })

    return NextResponse.json(
      { error: `Failed to assume role: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
