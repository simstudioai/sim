import neo4j from 'neo4j-driver'
import type { Neo4jConnectionConfig } from '@/tools/neo4j/types'

export async function createNeo4jDriver(config: Neo4jConnectionConfig) {
  const isAuraHost = config.host.includes('.databases.neo4j.io')

  let protocol: string
  if (isAuraHost) {
    protocol = 'neo4j+s'
  } else {
    protocol = config.encryption === 'enabled' ? 'bolt+s' : 'bolt'
  }

  const uri = `${protocol}://${config.host}:${config.port}`

  const driverConfig: any = {
    maxConnectionPoolSize: 1,
    connectionTimeout: 10000,
  }

  if (!protocol.endsWith('+s')) {
    driverConfig.encrypted = config.encryption === 'enabled' ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF'
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(config.username, config.password), driverConfig)

  await driver.verifyConnectivity()

  return driver
}

export function validateCypherQuery(
  query: string,
  allowDangerousOps = false
): { isValid: boolean; error?: string } {
  if (!query || typeof query !== 'string') {
    return {
      isValid: false,
      error: 'Query must be a non-empty string',
    }
  }

  if (!allowDangerousOps) {
    const dangerousPatterns = [
      /DROP\s+DATABASE/i,
      /DROP\s+CONSTRAINT/i,
      /DROP\s+INDEX/i,
      /CREATE\s+DATABASE/i,
      /CREATE\s+CONSTRAINT/i,
      /CREATE\s+INDEX/i,
      /CALL\s+dbms\./i,
      /CALL\s+db\./i,
      /LOAD\s+CSV/i,
      /apoc\.cypher\.run/i,
      /apoc\.load/i,
      /apoc\.periodic/i,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        return {
          isValid: false,
          error:
            'Query contains potentially dangerous operations (schema changes, system procedures, or external data loading)',
        }
      }
    }
  }

  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) {
    return {
      isValid: false,
      error: 'Query cannot be empty',
    }
  }

  return { isValid: true }
}

export function sanitizeLabelName(name: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      'Invalid label name. Must start with a letter and contain only letters, numbers, and underscores.'
    )
  }
  return name
}

export function sanitizePropertyKey(key: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
    throw new Error(
      'Invalid property key. Must start with a letter and contain only letters, numbers, and underscores.'
    )
  }
  return key
}

export function sanitizeRelationshipType(type: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(type)) {
    throw new Error(
      'Invalid relationship type. Must start with an uppercase letter and contain only uppercase letters, numbers, and underscores.'
    )
  }
  return type
}

export function convertNeo4jTypesToJSON(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as any).toNumber()
  }

  if (Array.isArray(value)) {
    return value.map(convertNeo4jTypesToJSON)
  }

  if (typeof value === 'object') {
    const obj = value as any

    if (obj.labels && obj.properties && obj.identity) {
      return {
        identity: obj.identity.toNumber ? obj.identity.toNumber() : obj.identity,
        labels: obj.labels,
        properties: convertNeo4jTypesToJSON(obj.properties),
      }
    }

    if (obj.type && obj.properties && obj.identity && obj.start && obj.end) {
      return {
        identity: obj.identity.toNumber ? obj.identity.toNumber() : obj.identity,
        start: obj.start.toNumber ? obj.start.toNumber() : obj.start,
        end: obj.end.toNumber ? obj.end.toNumber() : obj.end,
        type: obj.type,
        properties: convertNeo4jTypesToJSON(obj.properties),
      }
    }

    if (obj.start && obj.end && obj.segments) {
      return {
        start: convertNeo4jTypesToJSON(obj.start),
        end: convertNeo4jTypesToJSON(obj.end),
        segments: obj.segments.map((seg: any) => ({
          start: convertNeo4jTypesToJSON(seg.start),
          relationship: convertNeo4jTypesToJSON(seg.relationship),
          end: convertNeo4jTypesToJSON(seg.end),
        })),
        length: obj.length,
      }
    }

    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      result[key] = convertNeo4jTypesToJSON(val)
    }
    return result
  }

  return value
}
