import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createMongoDBConnection, sanitizeCollectionName, validateFilter } from '../utils'

const logger = createLogger('MongoDBQueryAPI')

const QuerySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  authSource: z.string().optional(),
  ssl: z.enum(['disabled', 'required', 'preferred']).default('preferred'),
  collection: z.string().min(1, 'Collection name is required'),
  query: z
    .union([z.string(), z.object({}).passthrough()])
    .optional()
    .default('{}')
    .transform((val) => {
      if (typeof val === 'object' && val !== null) {
        return JSON.stringify(val)
      }
      return val || '{}'
    }),
  limit: z
    .union([z.coerce.number().int().positive(), z.literal(''), z.undefined()])
    .optional()
    .transform((val) => {
      if (val === '' || val === undefined || val === null) {
        return 100
      }
      return val
    }),
  sort: z
    .union([z.string(), z.object({}).passthrough(), z.null()])
    .optional()
    .transform((val) => {
      if (typeof val === 'object' && val !== null) {
        return JSON.stringify(val)
      }
      return val
    }),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let client = null

  try {
    const body = await request.json()
    const params = QuerySchema.parse(body)

    logger.info(
      `[${requestId}] Executing MongoDB query on ${params.host}:${params.port}/${params.database}.${params.collection}`
    )

    const sanitizedCollection = sanitizeCollectionName(params.collection)

    let filter = {}
    if (params.query?.trim()) {
      const validation = validateFilter(params.query)
      if (!validation.isValid) {
        logger.warn(`[${requestId}] Filter validation failed: ${validation.error}`)
        return NextResponse.json(
          { error: `Filter validation failed: ${validation.error}` },
          { status: 400 }
        )
      }
      filter = JSON.parse(params.query)
    }

    let sortCriteria = {}
    if (params.sort?.trim()) {
      try {
        sortCriteria = JSON.parse(params.sort)
      } catch (error) {
        logger.warn(`[${requestId}] Invalid sort JSON: ${params.sort}`)
        return NextResponse.json({ error: 'Invalid JSON format in sort criteria' }, { status: 400 })
      }
    }

    client = await createMongoDBConnection({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      authSource: params.authSource,
      ssl: params.ssl,
    })

    const db = client.db(params.database)
    const coll = db.collection(sanitizedCollection)

    let cursor = coll.find(filter)

    if (Object.keys(sortCriteria).length > 0) {
      cursor = cursor.sort(sortCriteria)
    }

    const limit = params.limit || 100
    cursor = cursor.limit(limit)

    const documents = await cursor.toArray()

    logger.info(
      `[${requestId}] Query executed successfully, returned ${documents.length} documents`
    )

    return NextResponse.json({
      message: `Found ${documents.length} documents`,
      documents,
      documentCount: documents.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] MongoDB query failed:`, error)

    return NextResponse.json({ error: `MongoDB query failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (client) {
      await client.close()
    }
  }
}
