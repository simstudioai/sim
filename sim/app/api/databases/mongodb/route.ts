import { MongoClient } from 'mongodb'
import { NextResponse } from 'next/server'

interface MongoDBResult {
  modifiedCount?: number;
  deletedCount?: number;
  insertedCount?: number;
  [key: string]: any;
}

export async function POST(request: Request) {
  try {
    const params = await request.json()
    console.log('Received MongoDB API request:', {
      ...params,
      password: '[REDACTED]'
    })

    // Handle both flattened and nested connection parameters
    const connection = params.connection || params
    const { host, port, username, password, database, ssl } = connection
    const { operation, collection, query, projection, document, update, pipeline, options } = params

    const sslParam = ssl ? 'ssl=true' : ''
    const uri = `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=admin&${sslParam}`

    console.log('Connecting to MongoDB with URI:', uri.replace(password, '[REDACTED]'))

    // Connect to MongoDB
    const client = new MongoClient(uri)
    await client.connect()

    const db = client.db(database)
    const coll = db.collection(collection)

    let result
    switch (operation) {
      case 'find':
        result = await coll
          .find(query || {}, { projection })
          .limit(options?.limit || 0)
          .skip(options?.skip || 0)
          .sort(options?.sort || {})
          .toArray()
        break

      case 'insert':
        result = await coll.insertOne(document)
        break

      case 'update':
        result = await coll.updateOne(
          query || {},
          update || {},
          { upsert: options?.upsert }
        )
        break

      case 'delete':
        result = await coll.deleteOne(query || {})
        break

      case 'aggregate':
        result = await coll.aggregate(pipeline || []).toArray()
        break

      default:
        throw new Error(`Unsupported operation: ${operation}`)
    }

    await client.close()

    return NextResponse.json({
      data: result,
      affectedCount: (result as MongoDBResult).modifiedCount || 
                    (result as MongoDBResult).deletedCount || 
                    (result as MongoDBResult).insertedCount || 
                    (Array.isArray(result) ? result.length : 0),
      fields: Array.isArray(result) && result.length > 0 
        ? Object.keys(result[0] as Record<string, unknown>).map(key => ({ name: key })) 
        : []
    })

  } catch (error) {
    console.error('MongoDB API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
} 