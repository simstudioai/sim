import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mongodbUpdateContract } from '@/lib/api/contracts/tools/databases/mongodb'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createMongoDBConnection,
  sanitizeCollectionName,
  validateFilter,
} from '@/app/api/tools/mongodb/utils'

const logger = createLogger('MongoDBUpdateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)
  let client = null

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized MongoDB update attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(mongodbUpdateContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] MongoDB update failed:`, error)

    return NextResponse.json({ error: `MongoDB update failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (client) {
      await client.close()
    }
  }
})
