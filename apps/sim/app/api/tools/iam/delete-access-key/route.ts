import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, deleteAccessKey } from '../utils'

const logger = createLogger('IAMDeleteAccessKeyAPI')

const Schema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  accessKeyIdToDelete: z.string().min(1, 'Access key ID to delete is required'),
  userName: z.string().optional().nullable(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = Schema.parse(body)

    logger.info(`Deleting IAM access key "${params.accessKeyIdToDelete}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await deleteAccessKey(client, params.accessKeyIdToDelete, params.userName)
      logger.info(`Successfully deleted access key "${params.accessKeyIdToDelete}"`)
      return NextResponse.json({ message: `Access key "${params.accessKeyIdToDelete}" deleted` })
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
    logger.error(`Failed to delete access key:`, error)
    return NextResponse.json(
      { error: `Failed to delete access key: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
