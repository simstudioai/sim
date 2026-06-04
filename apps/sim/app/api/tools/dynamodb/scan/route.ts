import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsDynamodbScanContract } from '@/lib/api/contracts/tools/aws/dynamodb-scan'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, scanItems } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBScanAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsDynamodbScanContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Scanning table '${validatedData.tableName}'`)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await scanItems(client, validatedData.tableName, {
        filterExpression: validatedData.filterExpression,
        projectionExpression: validatedData.projectionExpression,
        expressionAttributeNames: validatedData.expressionAttributeNames,
        expressionAttributeValues: validatedData.expressionAttributeValues,
        limit: validatedData.limit,
        exclusiveStartKey: validatedData.exclusiveStartKey,
      })

      logger.info(
        `Scan completed for table '${validatedData.tableName}', returned ${result.count} items`
      )

      return NextResponse.json({
        message: `Scan returned ${result.count} items`,
        items: result.items,
        count: result.count,
        ...(result.lastEvaluatedKey && { lastEvaluatedKey: result.lastEvaluatedKey }),
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'DynamoDB scan failed'
    logger.error('DynamoDB scan failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
