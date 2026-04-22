import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, listPolicies } from '../utils'

const logger = createLogger('IAMListPoliciesAPI')

const Schema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  scope: z.string().optional().nullable(),
  onlyAttached: z.boolean().optional().nullable(),
  pathPrefix: z.string().optional().nullable(),
  maxItems: z.number().int().min(1).max(1000).optional().nullable(),
  marker: z.string().optional().nullable(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = Schema.parse(body)

    logger.info(`Listing IAM policies`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listPolicies(
        client,
        params.scope,
        params.onlyAttached,
        params.pathPrefix,
        params.maxItems,
        params.marker
      )
      logger.info(`Successfully listed ${result.count} IAM policies`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    logger.error(`Failed to list IAM policies:`, error)
    return NextResponse.json(
      { error: `Failed to list IAM policies: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
