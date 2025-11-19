import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { convertNeo4jTypesToJSON, createNeo4jDriver, validateCypherQuery } from '../utils'

const logger = createLogger('Neo4jQueryAPI')

const QuerySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  encryption: z.enum(['enabled', 'disabled']).default('disabled'),
  cypherQuery: z.string().min(1, 'Cypher query is required'),
  parameters: z.record(z.unknown()).optional().default({}),
  limit: z
    .union([z.coerce.number().int().positive(), z.literal(''), z.undefined()])
    .optional()
    .transform((val) => {
      if (val === '' || val === undefined || val === null) {
        return undefined
      }
      return val
    }),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let driver = null
  let session = null

  try {
    const body = await request.json()
    const params = QuerySchema.parse(body)

    logger.info(
      `[${requestId}] Executing Neo4j query on ${params.host}:${params.port}/${params.database}`
    )

    // Validate Cypher query
    const validation = validateCypherQuery(params.cypherQuery)
    if (!validation.isValid) {
      logger.warn(`[${requestId}] Cypher query validation failed: ${validation.error}`)
      return NextResponse.json(
        { error: `Query validation failed: ${validation.error}` },
        { status: 400 }
      )
    }

    // Create driver and session
    driver = await createNeo4jDriver({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      encryption: params.encryption,
    })

    session = driver.session({ database: params.database })

    // Add LIMIT clause if specified and not already in query
    let finalQuery = params.cypherQuery.trim()
    if (params.limit && !/\bLIMIT\s+\d+/i.test(finalQuery)) {
      finalQuery = `${finalQuery} LIMIT ${params.limit}`
    }

    // Execute query
    const result = await session.run(finalQuery, params.parameters)

    // Convert Neo4j types to JSON-serializable format
    const records = result.records.map((record) => {
      const obj: Record<string, unknown> = {}
      record.keys.forEach((key) => {
        obj[key] = convertNeo4jTypesToJSON(record.get(key))
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

    logger.info(`[${requestId}] Query executed successfully, returned ${records.length} records`)

    return NextResponse.json({
      message: `Found ${records.length} records`,
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
    logger.error(`[${requestId}] Neo4j query failed:`, error)

    return NextResponse.json({ error: `Neo4j query failed: ${errorMessage}` }, { status: 500 })
  } finally {
    if (session) {
      await session.close()
    }
    if (driver) {
      await driver.close()
    }
  }
}
