import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  convertNeo4jTypesToJSON,
  createNeo4jDriver,
  validateCypherQuery,
} from '@/app/api/tools/neo4j/utils'

const logger = createLogger('Neo4jUpdateAPI')

const UpdateSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  encryption: z.enum(['enabled', 'disabled']).default('disabled'),
  cypherQuery: z.string().min(1, 'Cypher query is required'),
  parameters: z.record(z.unknown()).nullable().optional().default({}),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let driver = null
  let session = null

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized Neo4j update attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = UpdateSchema.parse(body)

    logger.info(
      `[${requestId}] Executing Neo4j update on ${params.host}:${params.port}/${params.database}`
    )

    const validation = validateCypherQuery(params.cypherQuery)
    if (!validation.isValid) {
      logger.warn(`[${requestId}] Cypher query validation failed: ${validation.error}`)
      return NextResponse.json(
        { error: `Query validation failed: ${validation.error}` },
        { status: 400 }
      )
    }

    driver = await createNeo4jDriver({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      encryption: params.encryption,
    })

    session = driver.session({ database: params.database })

    const result = await session.run(params.cypherQuery, params.parameters)

    const records = result.records.map((record) => {
      const obj: Record<string, unknown> = {}
      record.keys.forEach((key) => {
        if (typeof key === 'string') {
          obj[key] = convertNeo4jTypesToJSON(record.get(key))
        }
      })
      return obj
    })

    const summary = {
      resultAvailableAfter: result.summary.resultAvailableAfter.toNumber(),
      resultConsumedAfter: result.summary.resultConsumedAfter.toNumber(),
      counters: {
        nodesCreated: result.summary.counters.updates().nodesCreated,
        nodesDeleted: result.summary.counters.updates().nodesDeleted,
        relationshipsCreated: result.summary.counters.updates().relationshipsCreated,
        relationshipsDeleted: result.summary.counters.updates().relationshipsDeleted,
        propertiesSet: result.summary.counters.updates().propertiesSet,
        labelsAdded: result.summary.counters.updates().labelsAdded,
        labelsRemoved: result.summary.counters.updates().labelsRemoved,
        indexesAdded: result.summary.counters.updates().indexesAdded,
        indexesRemoved: result.summary.counters.updates().indexesRemoved,
        constraintsAdded: result.summary.counters.updates().constraintsAdded,
        constraintsRemoved: result.summary.counters.updates().constraintsRemoved,
      },
    }

    logger.info(
      `[${requestId}] Update executed successfully, ${summary.counters.propertiesSet} properties set, returned ${records.length} records`
    )

    return NextResponse.json({
      message: `Updated ${summary.counters.propertiesSet} properties`,
      records,
      recordCount: records.length,
      summary,
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
    logger.error(`[${requestId}] Neo4j update failed:`, error)

    return NextResponse.json({ error: `Neo4j update failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (session) {
      await session.close()
    }
    if (driver) {
      await driver.close()
    }
  }
}
