import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createDynamoDBClient, getItem } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBGetAPI')

const GetSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().min(1, 'Table name is required'),
  key: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
    message: 'Key is required',
  }),
  consistentRead: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (val === true || val === 'true') return true
      return undefined
    }),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = GetSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage = toError(error).message || 'DynamoDB get failed'
    logger.error('DynamoDB get failed:', error)
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
