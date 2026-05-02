import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsDynamodbUpdateContract } from '@/lib/api/contracts/tools/aws/dynamodb-update'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, updateItem } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBUpdateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsDynamodbUpdateContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Updating item in table '${validatedData.tableName}'`)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await updateItem(
        client,
        validatedData.tableName,
        validatedData.key,
        validatedData.updateExpression,
        {
          expressionAttributeNames: validatedData.expressionAttributeNames,
          expressionAttributeValues: validatedData.expressionAttributeValues,
          conditionExpression: validatedData.conditionExpression,
        }
      )

      logger.info(`Update completed for table '${validatedData.tableName}'`)

      return NextResponse.json({
        message: 'Item updated successfully',
        item: result.attributes,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'DynamoDB update failed'
    logger.error('DynamoDB update failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
