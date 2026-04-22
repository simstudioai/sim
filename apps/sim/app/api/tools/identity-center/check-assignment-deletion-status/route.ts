import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkAssignmentDeletionStatus, createSSOAdminClient } from '../utils'

const logger = createLogger('IdentityCenterCheckAssignmentDeletionStatusAPI')

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
  requestId: z.string().min(1, 'Request ID is required'),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = Schema.parse(body)

    logger.info(`Checking assignment deletion status for request ${params.requestId}`)

    const client = createSSOAdminClient(params)
    try {
      const result = await checkAssignmentDeletionStatus(
        client,
        params.instanceArn,
        params.requestId
      )
      logger.info(`Assignment deletion status: ${result.status}`)
      return NextResponse.json({
        message: `Assignment deletion status: ${result.status}`,
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
    logger.error('Failed to check assignment deletion status:', error)
    return NextResponse.json(
      { error: `Failed to check assignment deletion status: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
