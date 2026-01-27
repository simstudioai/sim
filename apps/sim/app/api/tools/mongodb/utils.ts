import { MongoClient } from 'mongodb'
import type { MongoDBCollectionInfo, MongoDBConnectionConfig } from '@/tools/mongodb/types'

export async function createMongoDBConnection(config: MongoDBConnectionConfig) {
  const credentials =
    config.username && config.password
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
      : ''

  const queryParams = new URLSearchParams()

  if (config.authSource) {
    queryParams.append('authSource', config.authSource)
  }

  if (config.ssl === 'required') {
    queryParams.append('ssl', 'true')
  }

  const queryString = queryParams.toString()
  const uri = `mongodb://${credentials}${config.host}:${config.port}/${config.database}${queryString ? `?${queryString}` : ''}`

  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
    maxPoolSize: 1,
  })

  await client.connect()
  return client
}

/**
 * Recursively checks an object for dangerous MongoDB operators
 * @param obj - The object to check
 * @param dangerousOperators - Array of operator names to block
 * @returns true if a dangerous operator is found
 */
function containsDangerousOperator(obj: unknown, dangerousOperators: string[]): boolean {
  if (typeof obj !== 'object' || obj === null) return false

  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (dangerousOperators.includes(key)) return true
    if (
      typeof (obj as Record<string, unknown>)[key] === 'object' &&
      containsDangerousOperator((obj as Record<string, unknown>)[key], dangerousOperators)
    ) {
      return true
    }
  }
  return false
}

export function validateFilter(filter: string): { isValid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(filter)

    const dangerousOperators = [
      '$where', // Executes arbitrary JavaScript
      '$regex', // Can cause ReDoS attacks
      '$expr', // Expression evaluation
      '$function', // Custom JavaScript functions
      '$accumulator', // Custom JavaScript accumulators
      '$let', // Variable definitions that could be exploited
    ]

    if (containsDangerousOperator(parsed, dangerousOperators)) {
      return {
        isValid: false,
        error: 'Filter contains potentially dangerous operators',
      }
    }

    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid JSON format in filter',
    }
  }
}

export function validatePipeline(pipeline: string): { isValid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(pipeline)

    if (!Array.isArray(parsed)) {
      return {
        isValid: false,
        error: 'Pipeline must be an array',
      }
    }

    const dangerousOperators = [
      '$where', // Executes arbitrary JavaScript
      '$function', // Custom JavaScript functions
      '$accumulator', // Custom JavaScript accumulators
      '$let', // Variable definitions that could be exploited
      '$merge', // Writes to external collections
      '$out', // Writes to external collections
      '$currentOp', // Exposes system operation info
      '$listSessions', // Exposes session info
      '$listLocalSessions', // Exposes local session info
    ]

    for (const stage of parsed) {
      if (containsDangerousOperator(stage, dangerousOperators)) {
        return {
          isValid: false,
          error: 'Pipeline contains potentially dangerous operators',
        }
      }
    }

    return { isValid: true }
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid JSON format in pipeline',
    }
  }
}

export function sanitizeCollectionName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      'Invalid collection name. Must start with letter or underscore and contain only letters, numbers, and underscores.'
    )
  }
  return name
}

/**
 * Introspect MongoDB to get databases, collections, and indexes
 */
export async function executeIntrospect(
  client: MongoClient,
  database?: string
): Promise<{
  message: string
  databases: string[]
  collections: MongoDBCollectionInfo[]
}> {
  const databases: string[] = []
  const collections: MongoDBCollectionInfo[] = []

  if (database) {
    databases.push(database)
    const db = client.db(database)
    const collectionList = await db.listCollections().toArray()

    for (const collInfo of collectionList) {
      const coll = db.collection(collInfo.name)
      const indexes = await coll.indexes()
      const documentCount = await coll.estimatedDocumentCount()

      collections.push({
        name: collInfo.name,
        type: collInfo.type || 'collection',
        documentCount,
        indexes: indexes.map((idx) => ({
          name: idx.name || '',
          key: idx.key as Record<string, number>,
          unique: idx.unique || false,
          sparse: idx.sparse,
        })),
      })
    }
  } else {
    const admin = client.db().admin()
    const dbList = await admin.listDatabases()

    for (const dbInfo of dbList.databases) {
      databases.push(dbInfo.name)
    }
  }

  const message = database
    ? `Found ${collections.length} collections in database '${database}'`
    : `Found ${databases.length} databases`

  return {
    message,
    databases,
    collections,
  }
}
