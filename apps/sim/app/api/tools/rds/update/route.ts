import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createRdsClient, executeUpdate } from '@/app/api/tools/rds/utils'

const logger = createLogger('RDSUpdateAPI')

const UpdateSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
  table: z.string().min(1, 'Table name is required'),
  data: z.record(z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Data object must have at least one field',
  }),
  conditions: z.record(z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one condition is required',
  }),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = UpdateSchema.parse(body)

    logger.info(`[${requestId}] Updating RDS table ${params.table} in ${params.database}`)

    const client = createRdsClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      resourceArn: params.resourceArn,
      secretArn: params.secretArn,
      database: params.database,
    })

    try {
      const result = await executeUpdate(
        client,
        params.resourceArn,
        params.secretArn,
        params.database,
        params.table,
        params.data,
        params.conditions
      )

      logger.info(`[${requestId}] Update executed successfully, affected ${result.rowCount} rows`)

      return NextResponse.json({
        message: `Update executed successfully. ${result.rowCount} row(s) updated.`,
        rows: result.rows,
        rowCount: result.rowCount,
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
    logger.error(`[${requestId}] RDS update failed:`, error)

    return NextResponse.json({ error: `RDS update failed: ${errorMessage}` }, { status: 500 })
  }
}
