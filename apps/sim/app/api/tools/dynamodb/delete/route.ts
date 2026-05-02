import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsDynamodbDeleteContract } from '@/lib/api/contracts/tools/aws/dynamodb-delete'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, deleteItem } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBDeleteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsDynamodbDeleteContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Deleting item from table '${validatedData.tableName}'`)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      await deleteItem(client, validatedData.tableName, validatedData.key, {
        conditionExpression: validatedData.conditionExpression,
        expressionAttributeNames: validatedData.expressionAttributeNames,
        expressionAttributeValues: validatedData.expressionAttributeValues,
      })

      logger.info(`Delete completed for table '${validatedData.tableName}'`)

      return NextResponse.json({
        message: 'Item deleted successfully',
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'DynamoDB delete failed'
    logger.error('DynamoDB delete failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
