import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createMongoDBConnection, sanitizeCollectionName } from '../utils'

const logger = createLogger('MongoDBInsertAPI')

const InsertSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  authSource: z.string().optional(),
  ssl: z.enum(['disabled', 'required', 'preferred']).default('preferred'),
  collection: z.string().min(1, 'Collection name is required'),
  documents: z
    .union([z.array(z.record(z.unknown())), z.string()])
    .transform((val) => {
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val)
          return Array.isArray(parsed) ? parsed : [parsed]
        } catch {
          throw new Error('Invalid JSON in documents field')
        }
      }
      return val
    })
    .refine((val) => Array.isArray(val) && val.length > 0, {
      message: 'At least one document is required',
    }),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let client = null

  try {
    const body = await request.json()
    const params = InsertSchema.parse(body)

    logger.info(
      `[${requestId}] Inserting ${params.documents.length} document(s) into ${params.host}:${params.port}/${params.database}.${params.collection}`
    )

    const sanitizedCollection = sanitizeCollectionName(params.collection)
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
    if (params.documents.length === 1) {
      result = await coll.insertOne(params.documents[0] as Record<string, unknown>)
      logger.info(`[${requestId}] Single document inserted successfully`)
      return NextResponse.json({
        message: 'Document inserted successfully',
        insertedId: result.insertedId.toString(),
        documentCount: 1,
      })
    }
    result = await coll.insertMany(params.documents as Record<string, unknown>[])
    const insertedCount = Object.keys(result.insertedIds).length
    logger.info(`[${requestId}] ${insertedCount} documents inserted successfully`)
    return NextResponse.json({
      message: `${insertedCount} documents inserted successfully`,
      insertedIds: Object.values(result.insertedIds).map((id) => id.toString()),
      documentCount: insertedCount,
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
    logger.error(`[${requestId}] MongoDB insert failed:`, error)

    return NextResponse.json({ error: `MongoDB insert failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (client) {
      await client.close()
    }
  }
}
