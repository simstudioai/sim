import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createNeo4jDriver } from '@/app/api/tools/neo4j/utils'
import type { Neo4jNodeSchema, Neo4jRelationshipSchema } from '@/tools/neo4j/types'

const logger = createLogger('Neo4jIntrospectAPI')

const IntrospectSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  encryption: z.enum(['enabled', 'disabled']).default('disabled'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  let driver = null
  let session = null

  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    logger.warn(`[${requestId}] Unauthorized Neo4j introspect attempt`)
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = IntrospectSchema.parse(body)

    logger.info(
      `[${requestId}] Introspecting Neo4j database at ${params.host}:${params.port}/${params.database}`
    )

    driver = await createNeo4jDriver({
      host: params.host,
      port: params.port,
      database: params.database,
      username: params.username,
      password: params.password,
      encryption: params.encryption,
    })

    session = driver.session({ database: params.database })

    const labelsResult = await session.run(
      'CALL db.labels() YIELD label RETURN label ORDER BY label'
    )
    const labels: string[] = labelsResult.records.map((record) => record.get('label') as string)

    const relationshipTypesResult = await session.run(
      'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType'
    )
    const relationshipTypes: string[] = relationshipTypesResult.records.map(
      (record) => record.get('relationshipType') as string
    )

    const nodeSchemas: Neo4jNodeSchema[] = []
    try {
      const nodePropertiesResult = await session.run(
        'CALL db.schema.nodeTypeProperties() YIELD nodeLabels, propertyName, propertyTypes RETURN nodeLabels, propertyName, propertyTypes'
      )

      const nodePropertiesMap = new Map<string, Array<{ name: string; types: string[] }>>()

      for (const record of nodePropertiesResult.records) {
        const nodeLabels = record.get('nodeLabels') as string[]
        const propertyName = record.get('propertyName') as string
        const propertyTypes = record.get('propertyTypes') as string[]

        const labelKey = nodeLabels.join(':')
        if (!nodePropertiesMap.has(labelKey)) {
          nodePropertiesMap.set(labelKey, [])
        }
        nodePropertiesMap.get(labelKey)!.push({ name: propertyName, types: propertyTypes })
      }

      for (const [labelKey, properties] of nodePropertiesMap) {
        nodeSchemas.push({
          label: labelKey,
          properties,
        })
      }
    } catch (nodePropsError) {
      logger.warn(
        `[${requestId}] Could not fetch node properties (may not be supported in this Neo4j version): ${nodePropsError}`
      )
    }

    const relationshipSchemas: Neo4jRelationshipSchema[] = []
    try {
      const relPropertiesResult = await session.run(
        'CALL db.schema.relTypeProperties() YIELD relationshipType, propertyName, propertyTypes RETURN relationshipType, propertyName, propertyTypes'
      )

      const relPropertiesMap = new Map<string, Array<{ name: string; types: string[] }>>()

      for (const record of relPropertiesResult.records) {
        const relType = record.get('relationshipType') as string
        const propertyName = record.get('propertyName') as string | null
        const propertyTypes = record.get('propertyTypes') as string[]

        if (!relPropertiesMap.has(relType)) {
          relPropertiesMap.set(relType, [])
        }
        if (propertyName) {
          relPropertiesMap.get(relType)!.push({ name: propertyName, types: propertyTypes })
        }
      }

      for (const [relType, properties] of relPropertiesMap) {
        relationshipSchemas.push({
          type: relType,
          properties,
        })
      }
    } catch (relPropsError) {
      logger.warn(
        `[${requestId}] Could not fetch relationship properties (may not be supported in this Neo4j version): ${relPropsError}`
      )
    }

    const constraints: Array<{
      name: string
      type: string
      entityType: string
      properties: string[]
    }> = []
    try {
      const constraintsResult = await session.run('SHOW CONSTRAINTS')

      for (const record of constraintsResult.records) {
        const name = record.get('name') as string
        const type = record.get('type') as string
        const entityType = record.get('entityType') as string
        const properties = (record.get('properties') as string[]) || []

        constraints.push({ name, type, entityType, properties })
      }
    } catch (constraintsError) {
      logger.warn(
        `[${requestId}] Could not fetch constraints (may not be supported in this Neo4j version): ${constraintsError}`
      )
    }

    const indexes: Array<{ name: string; type: string; entityType: string; properties: string[] }> =
      []
    try {
      const indexesResult = await session.run('SHOW INDEXES')

      for (const record of indexesResult.records) {
        const name = record.get('name') as string
        const type = record.get('type') as string
        const entityType = record.get('entityType') as string
        const properties = (record.get('properties') as string[]) || []

        indexes.push({ name, type, entityType, properties })
      }
    } catch (indexesError) {
      logger.warn(
        `[${requestId}] Could not fetch indexes (may not be supported in this Neo4j version): ${indexesError}`
      )
    }

    logger.info(
      `[${requestId}] Introspection completed: ${labels.length} labels, ${relationshipTypes.length} relationship types, ${constraints.length} constraints, ${indexes.length} indexes`
    )

    return NextResponse.json({
      message: `Database introspection completed: found ${labels.length} labels, ${relationshipTypes.length} relationship types, ${nodeSchemas.length} node schemas, ${relationshipSchemas.length} relationship schemas, ${constraints.length} constraints, ${indexes.length} indexes`,
      labels,
      relationshipTypes,
      nodeSchemas,
      relationshipSchemas,
      constraints,
      indexes,
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
    logger.error(`[${requestId}] Neo4j introspection failed:`, error)

    return NextResponse.json(
      { error: `Neo4j introspection failed: ${errorMessage}` },
      { status: 500 }
    )
  } finally {
    if (session) {
      await session.close()
    }
    if (driver) {
      await driver.close()
    }
  }
}
