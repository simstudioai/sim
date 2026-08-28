import type {
  Abortable,
  BulkWriteOptions,
  DeleteOptions,
  Document,
  InsertOneOptions,
  MongoClient,
  Sort,
  UpdateOptions,
} from 'mongodb'
import { createMongodbClient, type MongodbConnectionConfig } from '@/lib/internal/mongodb/client'
import {
  sanitizeMongodbCollectionName,
  validateMongodbFilter,
  validateMongodbPipeline,
} from '@/lib/internal/mongodb/input-validation'
import { introspectMongodb } from '@/lib/internal/mongodb/introspection'
import type {
  MongodbDeleteInput,
  MongodbExecuteInput,
  MongodbInsertInput,
  MongodbIntrospectInput,
  MongodbQueryInput,
  MongodbUpdateInput,
} from '@/lib/internal/mongodb/schema'

export class MongodbOperationInputError extends Error {}

async function withMongodbClient<TResult>(
  input: MongodbConnectionConfig,
  signal: AbortSignal | undefined,
  execute: (client: MongoClient) => Promise<TResult>
): Promise<TResult> {
  const client = await createMongodbClient(input, signal)
  try {
    return await execute(client)
  } finally {
    await client.close()
  }
}

export function executeMongodbQuery(input: MongodbQueryInput, signal?: AbortSignal) {
  const collectionName = sanitizeMongodbCollectionName(input.collection)
  let filter: Document = {}

  if (input.query?.trim()) {
    const validation = validateMongodbFilter(input.query)
    if (!validation.isValid) {
      throw new MongodbOperationInputError(
        `Filter validation failed: ${validation.error ?? 'Invalid filter'}`
      )
    }
    filter = JSON.parse(input.query) as Document
  }

  let sortCriteria: Sort = {}
  if (input.sort?.trim()) {
    try {
      sortCriteria = JSON.parse(input.sort) as Sort
    } catch {
      throw new MongodbOperationInputError('Invalid JSON format in sort criteria')
    }
  }

  return withMongodbClient(input, signal, async (client) => {
    const collection = client.db(input.database).collection(collectionName)
    let cursor = collection.find(filter, { signal })

    if (Object.keys(sortCriteria).length > 0) {
      cursor = cursor.sort(sortCriteria)
    }

    cursor = cursor.limit(input.limit || 100)
    const documents = await cursor.toArray()
    signal?.throwIfAborted()
    return {
      message: `Found ${documents.length} documents`,
      documents,
      documentCount: documents.length,
    }
  })
}

export function executeMongodbAggregation(input: MongodbExecuteInput, signal?: AbortSignal) {
  const collectionName = sanitizeMongodbCollectionName(input.collection)
  const validation = validateMongodbPipeline(input.pipeline)
  if (!validation.isValid) {
    throw new MongodbOperationInputError(
      `Pipeline validation failed: ${validation.error ?? 'Invalid pipeline'}`
    )
  }
  const pipeline = JSON.parse(input.pipeline) as Document[]

  return withMongodbClient(input, signal, async (client) => {
    const documents = await client
      .db(input.database)
      .collection(collectionName)
      .aggregate(pipeline, { signal })
      .toArray()
    signal?.throwIfAborted()
    return {
      message: `Aggregation completed, returned ${documents.length} documents`,
      documents,
      documentCount: documents.length,
    }
  })
}

export function executeMongodbInsert(input: MongodbInsertInput, signal?: AbortSignal) {
  const collectionName = sanitizeMongodbCollectionName(input.collection)
  const documents = input.documents as Document[]

  return withMongodbClient(input, signal, async (client) => {
    const collection = client.db(input.database).collection(collectionName)

    if (documents.length === 1) {
      const options: InsertOneOptions & Abortable = { signal }
      const result = await collection.insertOne(documents[0], options)
      signal?.throwIfAborted()
      return {
        message: 'Document inserted successfully',
        insertedId: result.insertedId.toString(),
        documentCount: 1,
      }
    }

    const options: BulkWriteOptions & Abortable = { signal }
    const result = await collection.insertMany(documents, options)
    signal?.throwIfAborted()
    const insertedCount = Object.keys(result.insertedIds).length
    return {
      message: `${insertedCount} documents inserted successfully`,
      insertedIds: Object.values(result.insertedIds).map((id) => id.toString()),
      documentCount: insertedCount,
    }
  })
}

export function executeMongodbUpdate(input: MongodbUpdateInput, signal?: AbortSignal) {
  const collectionName = sanitizeMongodbCollectionName(input.collection)
  const validation = validateMongodbFilter(input.filter)
  if (!validation.isValid) {
    throw new MongodbOperationInputError(
      `Filter validation failed: ${validation.error ?? 'Invalid filter'}`
    )
  }

  let filter: Document
  let update: Document
  try {
    filter = JSON.parse(input.filter) as Document
    update = JSON.parse(input.update) as Document
  } catch {
    throw new MongodbOperationInputError('Invalid JSON format in filter or update')
  }

  return withMongodbClient(input, signal, async (client) => {
    const collection = client.db(input.database).collection(collectionName)
    const options: UpdateOptions & Abortable = { upsert: input.upsert, signal }
    const result = input.multi
      ? await collection.updateMany(filter, update, options)
      : await collection.updateOne(filter, update, options)
    signal?.throwIfAborted()
    return {
      message: `${result.modifiedCount} documents updated${result.upsertedCount ? `, ${result.upsertedCount} documents upserted` : ''}`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      documentCount: result.modifiedCount + (result.upsertedCount || 0),
      ...(result.upsertedId && { insertedId: result.upsertedId.toString() }),
    }
  })
}

export function executeMongodbDelete(input: MongodbDeleteInput, signal?: AbortSignal) {
  const collectionName = sanitizeMongodbCollectionName(input.collection)
  const validation = validateMongodbFilter(input.filter)
  if (!validation.isValid) {
    throw new MongodbOperationInputError(
      `Filter validation failed: ${validation.error ?? 'Invalid filter'}`
    )
  }

  let filter: Document
  try {
    filter = JSON.parse(input.filter) as Document
  } catch {
    throw new MongodbOperationInputError('Invalid JSON format in filter')
  }

  return withMongodbClient(input, signal, async (client) => {
    const collection = client.db(input.database).collection(collectionName)
    const options: DeleteOptions & Abortable = { signal }
    const result = input.multi
      ? await collection.deleteMany(filter, options)
      : await collection.deleteOne(filter, options)
    signal?.throwIfAborted()
    return {
      message: `${result.deletedCount} documents deleted`,
      deletedCount: result.deletedCount,
    }
  })
}

export function executeMongodbIntrospection(input: MongodbIntrospectInput, signal?: AbortSignal) {
  return withMongodbClient(
    { ...input, database: input.database || 'admin' },
    signal,
    async (client) => introspectMongodb(client, input.database, signal)
  )
}
