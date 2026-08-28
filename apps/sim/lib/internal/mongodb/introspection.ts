import type {
  Abortable,
  EstimatedDocumentCountOptions,
  IndexDescriptionInfo,
  ListDatabasesOptions,
  ListIndexesOptions,
  MongoClient,
} from 'mongodb'

export interface MongodbCollectionInfo {
  name: string
  type: string
  documentCount: number
  indexes: Array<{
    name: string
    key: Record<string, number>
    unique: boolean
    sparse?: boolean
  }>
}

export interface MongodbIntrospectionResult {
  message: string
  databases: string[]
  collections: MongodbCollectionInfo[]
}

export async function introspectMongodb(
  client: MongoClient,
  database?: string,
  signal?: AbortSignal
): Promise<MongodbIntrospectionResult> {
  const databases: string[] = []
  const collections: MongodbCollectionInfo[] = []

  if (database) {
    databases.push(database)
    const db = client.db(database)
    const collectionList = await db.listCollections({}, { signal }).toArray()

    for (const collectionInfo of collectionList) {
      signal?.throwIfAborted()
      const collection = db.collection(collectionInfo.name)
      const indexOptions: ListIndexesOptions & Abortable = { signal }
      const countOptions: EstimatedDocumentCountOptions & Abortable = { signal }
      const indexes = await collection.indexes(indexOptions)
      const documentCount = await collection.estimatedDocumentCount(countOptions)

      collections.push({
        name: collectionInfo.name,
        type: collectionInfo.type || 'collection',
        documentCount,
        indexes: indexes.map((index: IndexDescriptionInfo) => ({
          name: index.name || '',
          key: index.key as Record<string, number>,
          unique: index.unique || false,
          sparse: index.sparse,
        })),
      })
    }
  } else {
    const options: ListDatabasesOptions & Abortable = { signal }
    const databaseList = await client.db().admin().listDatabases(options)

    for (const databaseInfo of databaseList.databases) {
      databases.push(databaseInfo.name)
    }
  }

  signal?.throwIfAborted()
  return {
    message: database
      ? `Found ${collections.length} collections in database '${database}'`
      : `Found ${databases.length} databases`,
    databases,
    collections,
  }
}
