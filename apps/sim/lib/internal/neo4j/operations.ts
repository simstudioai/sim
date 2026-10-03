import { createLogger } from '@sim/logger'
import type { QueryResult, Session } from 'neo4j-driver'
import type {
  Neo4jCreateRequest,
  Neo4jDeleteRequest,
  Neo4jExecuteRequest,
  Neo4jIntrospectRequest,
  Neo4jMergeRequest,
  Neo4jQueryRequest,
  Neo4jUpdateRequest,
} from '@/lib/api/contracts/tools/databases/neo4j'
import { createNeo4jDriver } from '@/lib/internal/neo4j/client'
import { convertNeo4jValue } from '@/lib/internal/neo4j/values'
import type { Neo4jNodeSchema, Neo4jRelationshipSchema } from '@/tools/neo4j/types'

const logger = createLogger('Neo4jOperations')

export class Neo4jOperationInputError extends Error {}

type StatementInput =
  | Neo4jQueryRequest
  | Neo4jExecuteRequest
  | Neo4jCreateRequest
  | Neo4jUpdateRequest
  | Neo4jMergeRequest
  | Neo4jDeleteRequest

type StatementKind = 'query' | 'execute' | 'create' | 'update' | 'merge' | 'delete'

function validateCypherQuery(query: string): void {
  if (!query || typeof query !== 'string') {
    throw new Neo4jOperationInputError('Query must be a non-empty string')
  }
  if (!query.trim()) throw new Neo4jOperationInputError('Query cannot be empty')
}

function bindSessionAbort(session: Session, signal?: AbortSignal): () => void {
  if (!signal) return () => undefined
  const abort = () => {
    void session.close()
  }
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

function projectRecords(result: QueryResult): Array<Record<string, unknown>> {
  return result.records.map((record) => {
    const projected: Record<string, unknown> = {}
    for (const key of record.keys) {
      if (typeof key === 'string') projected[key] = convertNeo4jValue(record.get(key))
    }
    return projected
  })
}

function projectSummary(result: QueryResult) {
  const updates = result.summary.counters.updates()
  return {
    resultAvailableAfter: result.summary.resultAvailableAfter.toNumber(),
    resultConsumedAfter: result.summary.resultConsumedAfter.toNumber(),
    counters: {
      nodesCreated: updates.nodesCreated,
      nodesDeleted: updates.nodesDeleted,
      relationshipsCreated: updates.relationshipsCreated,
      relationshipsDeleted: updates.relationshipsDeleted,
      propertiesSet: updates.propertiesSet,
      labelsAdded: updates.labelsAdded,
      labelsRemoved: updates.labelsRemoved,
      indexesAdded: updates.indexesAdded,
      indexesRemoved: updates.indexesRemoved,
      constraintsAdded: updates.constraintsAdded,
      constraintsRemoved: updates.constraintsRemoved,
    },
  }
}

function statementResponse(kind: StatementKind, result: QueryResult) {
  const records = projectRecords(result)
  const summary = projectSummary(result)
  switch (kind) {
    case 'query':
      return {
        message: `Found ${records.length} records`,
        records,
        recordCount: records.length,
        summary,
      }
    case 'execute':
      return {
        message: `Query executed successfully, returned ${records.length} records`,
        records,
        recordCount: records.length,
        summary,
      }
    case 'create':
      return {
        message: `Created ${summary.counters.nodesCreated} nodes and ${summary.counters.relationshipsCreated} relationships`,
        records,
        recordCount: records.length,
        summary,
      }
    case 'update':
      return {
        message: `Updated ${summary.counters.propertiesSet} properties`,
        records,
        recordCount: records.length,
        summary,
      }
    case 'merge':
      return {
        message: `Merge completed: ${summary.counters.nodesCreated} nodes created, ${summary.counters.relationshipsCreated} relationships created`,
        records,
        recordCount: records.length,
        summary,
      }
    case 'delete':
      return {
        message: `Deleted ${summary.counters.nodesDeleted} nodes and ${summary.counters.relationshipsDeleted} relationships`,
        summary,
      }
  }
}

async function executeStatement(input: StatementInput, kind: StatementKind, signal?: AbortSignal) {
  signal?.throwIfAborted()
  validateCypherQuery(input.cypherQuery)
  const driver = await createNeo4jDriver({ ...input, port: Number(input.port) }, signal)
  const session = driver.session({ database: input.database })
  const unbindAbort = bindSessionAbort(session, signal)
  try {
    const result = await session.run(input.cypherQuery, input.parameters ?? {})
    signal?.throwIfAborted()
    return statementResponse(kind, result)
  } finally {
    unbindAbort()
    await session.close().catch(() => undefined)
    await driver.close().catch(() => undefined)
  }
}

export const executeNeo4jQuery = (input: Neo4jQueryRequest, signal?: AbortSignal) =>
  executeStatement(input, 'query', signal)
export const executeNeo4jStatement = (input: Neo4jExecuteRequest, signal?: AbortSignal) =>
  executeStatement(input, 'execute', signal)
export const executeNeo4jCreate = (input: Neo4jCreateRequest, signal?: AbortSignal) =>
  executeStatement(input, 'create', signal)
export const executeNeo4jUpdate = (input: Neo4jUpdateRequest, signal?: AbortSignal) =>
  executeStatement(input, 'update', signal)
export const executeNeo4jMerge = (input: Neo4jMergeRequest, signal?: AbortSignal) =>
  executeStatement(input, 'merge', signal)
export const executeNeo4jDelete = (input: Neo4jDeleteRequest, signal?: AbortSignal) =>
  executeStatement(input, 'delete', signal)

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export async function executeNeo4jIntrospection(
  input: Neo4jIntrospectRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const driver = await createNeo4jDriver({ ...input, port: Number(input.port) }, signal)
  const session = driver.session({ database: input.database })
  const unbindAbort = bindSessionAbort(session, signal)
  try {
    const labelsResult = await session.run(
      'CALL db.labels() YIELD label RETURN label ORDER BY label'
    )
    signal?.throwIfAborted()
    const labels = labelsResult.records.map((record) => String(record.get('label')))
    const relationshipTypesResult = await session.run(
      'CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType'
    )
    signal?.throwIfAborted()
    const relationshipTypes = relationshipTypesResult.records.map((record) =>
      String(record.get('relationshipType'))
    )

    const nodeSchemas: Neo4jNodeSchema[] = []
    try {
      const result = await session.run(
        'CALL db.schema.nodeTypeProperties() YIELD nodeLabels, propertyName, propertyTypes RETURN nodeLabels, propertyName, propertyTypes'
      )
      const byLabel = new Map<string, Array<{ name: string; types: string[] }>>()
      for (const record of result.records) {
        const label = stringArray(record.get('nodeLabels')).join(':')
        const properties = byLabel.get(label) ?? []
        properties.push({
          name: String(record.get('propertyName')),
          types: stringArray(record.get('propertyTypes')),
        })
        byLabel.set(label, properties)
      }
      for (const [label, properties] of byLabel) nodeSchemas.push({ label, properties })
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Could not fetch Neo4j node properties', { error })
    }

    const relationshipSchemas: Neo4jRelationshipSchema[] = []
    try {
      const result = await session.run(
        'CALL db.schema.relTypeProperties() YIELD relationshipType, propertyName, propertyTypes RETURN relationshipType, propertyName, propertyTypes'
      )
      const byType = new Map<string, Array<{ name: string; types: string[] }>>()
      for (const record of result.records) {
        const type = String(record.get('relationshipType'))
        const properties = byType.get(type) ?? []
        const propertyName = record.get('propertyName')
        if (typeof propertyName === 'string') {
          properties.push({ name: propertyName, types: stringArray(record.get('propertyTypes')) })
        }
        byType.set(type, properties)
      }
      for (const [type, properties] of byType) relationshipSchemas.push({ type, properties })
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Could not fetch Neo4j relationship properties', { error })
    }

    const constraints: Array<{
      name: string
      type: string
      entityType: string
      properties: string[]
    }> = []
    try {
      const result = await session.run('SHOW CONSTRAINTS')
      for (const record of result.records) {
        constraints.push({
          name: String(record.get('name')),
          type: String(record.get('type')),
          entityType: String(record.get('entityType')),
          properties: stringArray(record.get('properties')),
        })
      }
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Could not fetch Neo4j constraints', { error })
    }

    const indexes: Array<{ name: string; type: string; entityType: string; properties: string[] }> =
      []
    try {
      const result = await session.run('SHOW INDEXES')
      for (const record of result.records) {
        indexes.push({
          name: String(record.get('name')),
          type: String(record.get('type')),
          entityType: String(record.get('entityType')),
          properties: stringArray(record.get('properties')),
        })
      }
    } catch (error) {
      signal?.throwIfAborted()
      logger.warn('Could not fetch Neo4j indexes', { error })
    }
    signal?.throwIfAborted()

    return {
      message: `Database introspection completed: found ${labels.length} labels, ${relationshipTypes.length} relationship types, ${nodeSchemas.length} node schemas, ${relationshipSchemas.length} relationship schemas, ${constraints.length} constraints, ${indexes.length} indexes`,
      labels,
      relationshipTypes,
      nodeSchemas,
      relationshipSchemas,
      constraints,
      indexes,
    }
  } finally {
    unbindAbort()
    await session.close().catch(() => undefined)
    await driver.close().catch(() => undefined)
  }
}
