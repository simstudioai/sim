import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createMongoDBConnection, sanitizeCollectionName, validateFilter } from '../utils'

const logger = createLogger('MongoDBDeleteAPI')

const DeleteSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  authSource: z.string().optional(),
  ssl: z.enum(['disabled', 'required', 'preferred']).default('preferred'),
  collection: z.string().min(1, 'Collection name is required'),
  filter: z
    .union([z.string(), z.object({}).passthrough()])
    .transform((val) => {
      if (typeof val === 'object' && val !== null) {
        return JSON.stringify(val)
      }
      return val
    })
    .refine((val) => val && val.trim() !== '' && val !== '{}', {
      message: 'Filter is required for MongoDB Delete',
    }),
  multi: z
    .union([z.boolean(), z.string(), z.undefined()])
    .optional()
    .transform((val) => {
      if (val === 'true' || val === true) return true
      if (val === 'false' || val === false) return false
      return false // Default to false
    }),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let client = null

  try {
    const body = await request.json()
    const params = DeleteSchema.parse(body)

    logger.info(
      `[${requestId}] Deleting document(s) from ${params.host}:${params.port}/${params.database}.${params.collection} (multi: ${params.multi})`
    )

    const sanitizedCollection = sanitizeCollectionName(params.collection)

    const filterValidation = validateFilter(params.filter)
    if (!filterValidation.isValid) {
      logger.warn(`[${requestId}] Filter validation failed: ${filterValidation.error}`)
      return NextResponse.json(
        { error: `Filter validation failed: ${filterValidation.error}` },
        { status: 400 }
      )
    }

    let filterDoc
    try {
      filterDoc = JSON.parse(params.filter)
    } catch (error) {
      logger.warn(`[${requestId}] Invalid filter JSON: ${params.filter}`)
      return NextResponse.json({ error: 'Invalid JSON format in filter' }, { status: 400 })
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

    let result
    if (params.multi) {
      result = await coll.deleteMany(filterDoc)
    } else {
      result = await coll.deleteOne(filterDoc)
    }

    logger.info(`[${requestId}] Delete completed: ${result.deletedCount} documents deleted`)

    return NextResponse.json({
      message: `${result.deletedCount} documents deleted`,
      deletedCount: result.deletedCount,
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
    logger.error(`[${requestId}] MongoDB delete failed:`, error)

    return NextResponse.json({ error: `MongoDB delete failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (client) {
      await client.close()
    }
  }
}
