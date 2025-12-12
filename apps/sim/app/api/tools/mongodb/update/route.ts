import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createMongoDBConnection, sanitizeCollectionName, validateFilter } from '../utils'

const logger = createLogger('MongoDBUpdateAPI')

const UpdateSchema = z.object({
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
      message: 'Filter is required for MongoDB Update',
    }),
  update: z
    .union([z.string(), z.object({}).passthrough()])
    .transform((val) => {
      if (typeof val === 'object' && val !== null) {
        return JSON.stringify(val)
      }
      return val
    })
    .refine((val) => val && val.trim() !== '', {
      message: 'Update is required',
    }),
  upsert: z
    .union([z.boolean(), z.string(), z.undefined()])
    .optional()
    .transform((val) => {
      if (val === 'true' || val === true) return true
      if (val === 'false' || val === false) return false
      return false
    }),
  multi: z
    .union([z.boolean(), z.string(), z.undefined()])
    .optional()
    .transform((val) => {
      if (val === 'true' || val === true) return true
      if (val === 'false' || val === false) return false
      return false
    }),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let client = null

  try {
    const body = await request.json()
    const params = UpdateSchema.parse(body)

    logger.info(
      `[${requestId}] Updating document(s) in ${params.host}:${params.port}/${params.database}.${params.collection} (multi: ${params.multi}, upsert: ${params.upsert})`
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
    let updateDoc
    try {
      filterDoc = JSON.parse(params.filter)
      updateDoc = JSON.parse(params.update)
    } catch (error) {
      logger.warn(`[${requestId}] Invalid JSON in filter or update`)
      return NextResponse.json(
        { error: 'Invalid JSON format in filter or update' },
        { status: 400 }
      )
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
      result = await coll.updateMany(filterDoc, updateDoc, { upsert: params.upsert })
    } else {
      result = await coll.updateOne(filterDoc, updateDoc, { upsert: params.upsert })
    }

    logger.info(
      `[${requestId}] Update completed: ${result.modifiedCount} modified, ${result.matchedCount} matched${result.upsertedCount ? `, ${result.upsertedCount} upserted` : ''}`
    )

    return NextResponse.json({
      message: `${result.modifiedCount} documents updated${result.upsertedCount ? `, ${result.upsertedCount} documents upserted` : ''}`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      documentCount: result.modifiedCount + (result.upsertedCount || 0),
      ...(result.upsertedId && { insertedId: result.upsertedId.toString() }),
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
    logger.error(`[${requestId}] MongoDB update failed:`, error)

    return NextResponse.json({ error: `MongoDB update failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (client) {
      await client.close()
    }
  }
}
