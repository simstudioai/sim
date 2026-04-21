import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createRawDynamoDBClient, describeTable, listTables } from '@/app/api/tools/dynamodb/utils'

const logger = createLogger('DynamoDBIntrospectAPI')

const IntrospectSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  tableName: z.string().optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = IntrospectSchema.parse(body)

    logger.info(`Introspecting DynamoDB in region ${params.region}`)

    const client = createRawDynamoDBClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const { tables } = await listTables(client)

      if (params.tableName) {
        logger.info(`Describing table: ${params.tableName}`)
        const { tableDetails } = await describeTable(client, params.tableName)

        logger.info(`Table description completed for '${params.tableName}'`)

        return NextResponse.json({
          message: `Table '${params.tableName}' described successfully.`,
          tables,
          tableDetails,
        })
      }

      logger.info(`Listed ${tables.length} tables`)

      return NextResponse.json({
        message: `Found ${tables.length} table(s) in region '${params.region}'.`,
        tables,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = toError(error).message || 'Unknown error occurred'
    logger.error('DynamoDB introspection failed:', error)

    return NextResponse.json(
      { error: `DynamoDB introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
