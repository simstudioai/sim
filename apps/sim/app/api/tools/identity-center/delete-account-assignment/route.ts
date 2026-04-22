import {
  DeleteAccountAssignmentCommand,
  type PrincipalType,
  type TargetType,
} from '@aws-sdk/client-sso-admin'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSSOAdminClient, mapAssignmentStatus } from '../utils'

const logger = createLogger('IdentityCenterDeleteAccountAssignmentAPI')

const Schema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  instanceArn: z.string().min(1, 'Instance ARN is required'),
  accountId: z.string().min(1, 'Account ID is required'),
  permissionSetArn: z.string().min(1, 'Permission set ARN is required'),
  principalType: z.enum(['USER', 'GROUP']),
  principalId: z.string().min(1, 'Principal ID is required'),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = Schema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    logger.error('Failed to delete account assignment:', error)
    return NextResponse.json(
      { error: `Failed to delete account assignment: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
