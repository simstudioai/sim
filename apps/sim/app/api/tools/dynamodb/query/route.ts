import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, queryItems } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBQueryAPI')

const QuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().min(1, 'Table name is required'),
  keyConditionExpression: z.string().min(1, 'Key condition expression is required'),
  filterExpression: z.string().optional(),
  expressionAttributeNames: z.record(z.string()).optional(),
  expressionAttributeValues: z.record(z.unknown()).optional(),
  indexName: z.string().optional(),
  limit: z.number().positive().optional(),
  exclusiveStartKey: z.record(z.unknown()).optional(),
  scanIndexForward: z.boolean().optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = QuerySchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage = toError(error).message || 'DynamoDB query failed'
    logger.error('DynamoDB query failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
