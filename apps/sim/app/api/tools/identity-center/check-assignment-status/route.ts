import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterCheckAssignmentStatusContract } from '@/lib/api/contracts/tools/aws/identity-center-check-assignment-status'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkAssignmentCreationStatus, createSSOAdminClient } from '../utils'

const logger = createLogger('IdentityCenterCheckAssignmentStatusAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIdentityCenterCheckAssignmentStatusContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Checking assignment status for request ${params.requestId}`)

    const client = createSSOAdminClient(params)
    try {
      const result = await checkAssignmentCreationStatus(
        client,
        params.instanceArn,
        params.requestId
      )
      logger.info(`Assignment status: ${result.status}`)
      return NextResponse.json({
        message: `Assignment status: ${result.status}`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to check assignment status:', error)
    return NextResponse.json(
      { error: `Failed to check assignment status: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
