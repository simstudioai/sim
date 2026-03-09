import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createRawDynamoDBClient, describeTable, listTables } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBIntrospectAPI')

const IntrospectSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = IntrospectSchema.parse(body)

    logger.info(`[${requestId}] Introspecting DynamoDB in region ${params.region}`)

    const client = createRawDynamoDBClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const { tables } = await listTables(client)

      if (params.tableName) {
        logger.info(`[${requestId}] Describing table: ${params.tableName}`)
        const { tableDetails } = await describeTable(client, params.tableName)

        logger.info(`[${requestId}] Table description completed for '${params.tableName}'`)

        return NextResponse.json({
          message: `Table '${params.tableName}' described successfully.`,
          tables,
          tableDetails,
        })
      }

      logger.info(`[${requestId}] Listed ${tables.length} tables`)

      return NextResponse.json({
        message: `Found ${tables.length} table(s) in region '${params.region}'.`,
        tables,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] DynamoDB introspection failed:`, error)

    return NextResponse.json(
      { error: `DynamoDB introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
