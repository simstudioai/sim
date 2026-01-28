import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createDynamoDBClient, getItem } from '@/app/api/tools/dynamodb/utils'

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

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = GetSchema.parse(body)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    const result = await getItem(
      client,
      validatedData.tableName,
      validatedData.key,
      validatedData.consistentRead
    )

    return NextResponse.json({
      message: result.item ? 'Item retrieved successfully' : 'Item not found',
      item: result.item,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'DynamoDB get failed'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
