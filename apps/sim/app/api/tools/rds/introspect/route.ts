import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createRdsClient, executeIntrospect, type RdsEngine } from '@/app/api/tools/rds/utils'

const logger = createLogger('RDSIntrospectAPI')

const IntrospectSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  resourceArn: z.string().min(1, 'Resource ARN is required'),
  secretArn: z.string().min(1, 'Secret ARN is required'),
  database: z.string().optional(),
  schema: z.string().optional(),
  engine: z.enum(['aurora-postgresql', 'aurora-mysql']).optional(),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = IntrospectSchema.parse(body)

    logger.info(
      `[${requestId}] Introspecting RDS Aurora database${params.database ? ` (${params.database})` : ''}`
    )

    const client = createRdsClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      resourceArn: params.resourceArn,
      secretArn: params.secretArn,
      database: params.database,
    })

    try {
      const result = await executeIntrospect(
        client,
        params.resourceArn,
        params.secretArn,
        params.database,
        params.schema,
        params.engine as RdsEngine | undefined
      )

      logger.info(
        `[${requestId}] Introspection completed successfully. Engine: ${result.engine}, found ${result.tables.length} tables`
      )

      return NextResponse.json({
        message: `Schema introspection completed. Engine: ${result.engine}. Found ${result.tables.length} table(s).`,
        engine: result.engine,
        tables: result.tables,
        schemas: result.schemas,
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
    logger.error(`[${requestId}] RDS introspection failed:`, error)

    return NextResponse.json(
      { error: `RDS introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
