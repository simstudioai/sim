import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { mongodbExecuteContract } from '@/lib/api/contracts/tools/databases/mongodb'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createMongoDBConnection,
  sanitizeCollectionName,
  validatePipeline,
} from '@/app/api/tools/mongodb/utils'

const logger = createLogger('MongoDBExecuteAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)
  let client = null

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized MongoDB execute attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(mongodbExecuteContract, request, { logger })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Executing aggregation pipeline on ${params.host}:${params.port}/${params.database}.${params.collection}`
    )

    const sanitizedCollection = sanitizeCollectionName(params.collection)

    const pipelineValidation = validatePipeline(params.pipeline)
    if (!pipelineValidation.isValid) {
      logger.warn(`[${requestId}] Pipeline validation failed: ${pipelineValidation.error}`)
      return NextResponse.json(
        { error: `Pipeline validation failed: ${pipelineValidation.error}` },
        { status: 400 }
      )
    }

    const pipelineDoc = JSON.parse(params.pipeline)

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

    const cursor = coll.aggregate(pipelineDoc)
    const documents = await cursor.toArray()

    logger.info(
      `[${requestId}] Aggregation completed successfully, returned ${documents.length} documents`
    )

    return NextResponse.json({
      message: `Aggregation completed, returned ${documents.length} documents`,
      documents,
      documentCount: documents.length,
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] MongoDB aggregation failed:`, error)

    return NextResponse.json(
      { error: `MongoDB aggregation failed: ${errorMessage}` },
      { status: 500 }
    )
  } finally {
    if (client) {
      await client.close()
    }
  }
})
