import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assumeRole, createSTSClient } from '../utils'

const logger = createLogger('STSAssumeRoleAPI')

const AssumeRoleSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  roleArn: z.string().min(1, 'Role ARN is required'),
  roleSessionName: z.string().min(1, 'Role session name is required'),
  durationSeconds: z.number().int().min(900).max(43200).nullish(),
  policy: z.string().max(2048).nullish(),
  externalId: z.string().nullish(),
  serialNumber: z.string().nullish(),
  tokenCode: z.string().nullish(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = AssumeRoleSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to assume role', { error: toError(error).message })

    return NextResponse.json(
      { error: `Failed to assume role: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
