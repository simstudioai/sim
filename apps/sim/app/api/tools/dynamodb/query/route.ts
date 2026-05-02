import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsDynamodbQueryContract } from '@/lib/api/contracts/tools/aws/dynamodb-query'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, queryItems } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBQueryAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsDynamodbQueryContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Querying table '${validatedData.tableName}'`)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await queryItems(
        client,
        validatedData.tableName,
        validatedData.keyConditionExpression,
        {
          filterExpression: validatedData.filterExpression,
          expressionAttributeNames: validatedData.expressionAttributeNames,
          expressionAttributeValues: validatedData.expressionAttributeValues,
          indexName: validatedData.indexName,
          limit: validatedData.limit,
          exclusiveStartKey: validatedData.exclusiveStartKey,
          scanIndexForward: validatedData.scanIndexForward,
        }
      )

      logger.info(
        `Query completed for table '${validatedData.tableName}', returned ${result.count} items`
      )

      return NextResponse.json({
        message: `Query returned ${result.count} items`,
        items: result.items,
        count: result.count,
        ...(result.lastEvaluatedKey && { lastEvaluatedKey: result.lastEvaluatedKey }),
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'DynamoDB query failed'
    logger.error('DynamoDB query failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
