import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createDynamoDBClient, deleteItem } from '@/app/api/tools/dynamodb/utils'

const DeleteSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().min(1, 'Table name is required'),
  key: z.record(z.unknown()).refine((val) => Object.keys(val).length > 0, {
    message: 'Key is required',
  }),
  conditionExpression: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = DeleteSchema.parse(body)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    await deleteItem(
      client,
      validatedData.tableName,
      validatedData.key,
      validatedData.conditionExpression
    )

    return NextResponse.json({
      message: 'Item deleted successfully',
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'DynamoDB delete failed'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
