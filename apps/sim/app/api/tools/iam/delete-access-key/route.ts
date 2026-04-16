import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateId } from '@/lib/core/utils/uuid'
import { createIAMClient, deleteAccessKey } from '../utils'

const logger = createLogger('IAMDeleteAccessKeyAPI')

const Schema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  accessKeyIdToDelete: z.string().min(1, 'Access key ID to delete is required'),
  userName: z.string().optional(),
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

    logger.info(`[${requestId}] Deleting IAM access key "${params.accessKeyIdToDelete}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      await deleteAccessKey(client, params.accessKeyIdToDelete, params.userName)
      logger.info(`[${requestId}] Successfully deleted access key "${params.accessKeyIdToDelete}"`)
      return NextResponse.json({ message: `Access key "${params.accessKeyIdToDelete}" deleted` })
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
    logger.error(`[${requestId}] Failed to delete access key:`, error)
    return NextResponse.json(
      { error: `Failed to delete access key: ${errorMessage}` },
      { status: 500 }
    )
  }
}
