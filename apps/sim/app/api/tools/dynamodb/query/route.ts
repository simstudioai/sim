import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createDynamoDBClient, queryItems } from '@/app/api/tools/dynamodb/utils'

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
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = QuerySchema.parse(body)

    const client = createDynamoDBClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

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
      }
    )

    return NextResponse.json({
      message: `Query returned ${result.count} items`,
      items: result.items,
      count: result.count,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'DynamoDB query failed'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
