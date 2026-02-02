import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createDynamoDBClient, updateItem } from '@/app/api/tools/dynamodb/utils'

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

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = UpdateSchema.parse(body)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

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

    return NextResponse.json({
      message: 'Item updated successfully',
      item: result.attributes,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'DynamoDB update failed'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
