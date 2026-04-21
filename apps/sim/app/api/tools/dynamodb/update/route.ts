import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, updateItem } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBUpdateAPI')

const UpdateSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().min(1, 'Table name is required'),
  key: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
    message: 'Key is required',
  }),
  updateExpression: z.string().min(1, 'Update expression is required'),
  expressionAttributeNames: z.record(z.string()).optional(),
  expressionAttributeValues: z.record(z.unknown()).optional(),
  conditionExpression: z.string().optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = UpdateSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage = toError(error).message || 'DynamoDB update failed'
    logger.error('DynamoDB update failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
