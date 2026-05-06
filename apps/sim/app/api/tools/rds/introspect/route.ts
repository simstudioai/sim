import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { rdsIntrospectContract } from '@/lib/api/contracts/tools/databases/rds'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createRdsClient, executeIntrospect, type RdsEngine } from '@/app/api/tools/rds/utils'

const logger = createLogger('RDSIntrospectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(rdsIntrospectContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] RDS introspection failed:`, error)

    return NextResponse.json(
      { error: `RDS introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
