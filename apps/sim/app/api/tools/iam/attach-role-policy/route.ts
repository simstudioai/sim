import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'
import { attachRolePolicy, createIAMClient } from '../utils'

const logger = createLogger('IAMAttachRolePolicyAPI')

const Schema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  roleName: z.string().min(1, 'Role name is required'),
  policyArn: z.string().min(1, 'Policy ARN is required'),
})

export async function POST(request: NextRequest) {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = Schema.parse(body)

    logger.info(`[${requestId}] Attaching policy to IAM role "${params.roleName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await attachRolePolicy(client, params.roleName, params.policyArn)
      logger.info(`[${requestId}] Successfully attached policy to IAM role "${params.roleName}"`)
      return NextResponse.json({
        message: `Policy "${params.policyArn}" attached to role "${params.roleName}"`,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] Failed to attach role policy:`, error)
    return NextResponse.json(
      { error: `Failed to attach role policy: ${errorMessage}` },
      { status: 500 }
    )
  }
}
