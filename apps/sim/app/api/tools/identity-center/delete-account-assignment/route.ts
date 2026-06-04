import {
  DeleteAccountAssignmentCommand,
  type PrincipalType,
  type TargetType,
} from '@aws-sdk/client-sso-admin'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIdentityCenterDeleteAccountAssignmentContract } from '@/lib/api/contracts/tools/aws/identity-center-delete-account-assignment'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSOAdminClient, mapAssignmentStatus } from '../utils'

const logger = createLogger('IdentityCenterDeleteAccountAssignmentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(
      awsIdentityCenterDeleteAccountAssignmentContract,
      request,
      {
        errorFormat: 'details',
        logger,
      }
    )
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `Deleting account assignment for ${params.principalType} ${params.principalId} on account ${params.accountId}`
    )

    const client = createSSOAdminClient(params)
    try {
      const command = new DeleteAccountAssignmentCommand({
        InstanceArn: params.instanceArn,
        TargetId: params.accountId,
        TargetType: 'AWS_ACCOUNT' as TargetType,
        PermissionSetArn: params.permissionSetArn,
        PrincipalType: params.principalType as PrincipalType,
        PrincipalId: params.principalId,
      })
      const response = await client.send(command)
      const status = response.AccountAssignmentDeletionStatus ?? {}
      const result = mapAssignmentStatus(status)

      logger.info(
        `Account assignment deletion initiated with status ${result.status}, requestId ${result.requestId}`
      )

      return NextResponse.json({
        message: `Account assignment deletion ${result.status === 'SUCCEEDED' ? 'succeeded' : 'initiated'}`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to delete account assignment:', error)
    return NextResponse.json(
      { error: `Failed to delete account assignment: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
