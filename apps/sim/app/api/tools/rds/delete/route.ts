import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { rdsDeleteContract } from '@/lib/api/contracts/tools/databases/rds'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createRdsClient, executeDelete } from '@/app/api/tools/rds/utils'

const logger = createLogger('RDSDeleteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(rdsDeleteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Deleting from RDS table ${params.table} in ${params.database}`)

    const client = createRdsClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      resourceArn: params.resourceArn,
      secretArn: params.secretArn,
      database: params.database,
    })

    try {
      const result = await executeDelete(
        client,
        params.resourceArn,
        params.secretArn,
        params.database,
        params.table,
        params.conditions
      )

      logger.info(`[${requestId}] Delete executed successfully, affected ${result.rowCount} rows`)

      return NextResponse.json({
        message: `Delete executed successfully. ${result.rowCount} row(s) deleted.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] RDS delete failed:`, error)

    return NextResponse.json({ error: `RDS delete failed: ${errorMessage}` }, { status: 500 })
  }
})
