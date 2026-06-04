import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { rdsExecuteContract } from '@/lib/api/contracts/tools/databases/rds'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createRdsClient, executeStatement } from '@/app/api/tools/rds/utils'

const logger = createLogger('RDSExecuteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(rdsExecuteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Executing raw SQL on RDS database ${params.database}`)

    const client = createRdsClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      resourceArn: params.resourceArn,
      secretArn: params.secretArn,
      database: params.database,
    })

    try {
      const result = await executeStatement(
        client,
        params.resourceArn,
        params.secretArn,
        params.database,
        params.query
      )

      logger.info(`[${requestId}] Execute completed successfully, affected ${result.rowCount} rows`)

      return NextResponse.json({
        message: `Query executed successfully. ${result.rowCount} row(s) affected.`,
        rows: result.rows,
        rowCount: result.rowCount,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] RDS execute failed:`, error)

    return NextResponse.json({ error: `RDS execute failed: ${errorMessage}` }, { status: 500 })
  }
})
