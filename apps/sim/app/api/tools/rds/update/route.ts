import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { rdsUpdateContract } from '@/lib/api/contracts/tools/databases/rds'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createRdsClient, executeUpdate } from '@/app/api/tools/rds/utils'

const logger = createLogger('RDSUpdateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(rdsUpdateContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

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
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] RDS update failed:`, error)

    return NextResponse.json({ error: `RDS update failed: ${errorMessage}` }, { status: 500 })
  }
})
