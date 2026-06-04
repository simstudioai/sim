import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsDynamodbGetContract } from '@/lib/api/contracts/tools/aws/dynamodb-get'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, getItem } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBGetAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsDynamodbGetContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Getting item from table '${validatedData.tableName}'`)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await getItem(
        client,
        validatedData.tableName,
        validatedData.key,
        validatedData.consistentRead
      )

      logger.info(`Get item completed for table '${validatedData.tableName}'`)

      return NextResponse.json({
        message: result.item ? 'Item retrieved successfully' : 'Item not found',
        item: result.item,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = toError(error).message || 'DynamoDB get failed'
    logger.error('DynamoDB get failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
