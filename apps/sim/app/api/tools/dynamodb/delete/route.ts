import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, deleteItem } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBDeleteAPI')

const DeleteSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().min(1, 'Table name is required'),
  key: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
    message: 'Key is required',
  }),
  conditionExpression: z.string().optional(),
  expressionAttributeNames: z.record(z.string()).optional(),
  expressionAttributeValues: z.record(z.unknown()).optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = DeleteSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage = toError(error).message || 'DynamoDB delete failed'
    logger.error('DynamoDB delete failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
