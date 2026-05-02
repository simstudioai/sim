import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mongodbDeleteContract } from '@/lib/api/contracts/tools/databases/mongodb'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createMongoDBConnection,
  sanitizeCollectionName,
  validateFilter,
} from '@/app/api/tools/mongodb/utils'

const logger = createLogger('MongoDBDeleteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)
  let client = null

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized MongoDB delete attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(mongodbDeleteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] MongoDB delete failed:`, error)

    return NextResponse.json({ error: `MongoDB delete failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (client) {
      await client.close()
    }
  }
})
