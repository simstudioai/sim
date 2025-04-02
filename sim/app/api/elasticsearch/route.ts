import { Client } from '@elastic/elasticsearch'
import { NextResponse } from 'next/server'

// Elasticsearch connection pool
const esClients = new Map<string, any>()

function getElasticsearchClient(connection: any) {
  const key = connection.node
  if (!esClients.has(key)) {
    const client = new Client({
      node: connection.node,
      auth: connection.auth,
      tls: connection.tls ? { rejectUnauthorized: false } : undefined,
      cloud: connection.cloud,
      maxRetries: 3,
      requestTimeout: 30000,
      sniffOnStart: true,
    })
    esClients.set(key, client)
  }
  return esClients.get(key)
}

export async function POST(request: Request) {
  try {
    const params = await request.json()
    const { connection, operation, index, id, query, document, mapping, documents, options } = params

    // Get or create Elasticsearch client
    const client = getElasticsearchClient(connection)

    let result
    try {
      switch (operation) {
        case 'search':
          result = await client.search({
            index,
            ...query,
            ...options,
          })
          break

        case 'index':
          result = await client.index({
            index,
            id,
            document,
            refresh: true,
            ...options,
          })
          break

        case 'update':
          result = await client.update({
            index,
            id,
            doc: document,
            refresh: true,
            ...options,
          })
          break

        case 'delete':
          result = await client.delete({
            index,
            id,
            refresh: true,
            ...options,
          })
          break

        case 'create_index':
          result = await client.indices.create({
            index,
            body: {
              mappings: mapping,
              settings: {
                number_of_shards: 1,
                number_of_replicas: 1,
              },
            },
          })
          break

        case 'delete_index':
          result = await client.indices.delete({
            index,
          })
          break

        case 'get':
          result = await client.get({
            index,
            id,
          })
          break

        case 'bulk':
          const operations = documents.flatMap((doc: Record<string, any>) => [
            { index: { _index: index } },
            doc
          ])
          result = await client.bulk({
            operations,
            refresh: true,
            ...options,
          })
          break

        default:
          throw new Error(`Unsupported operation: ${operation}`)
      }
    } catch (error) {
      // Handle specific Elasticsearch errors
      if (error instanceof Error) {
        if (error.message.includes('Connection refused')) {
          throw new Error('Could not connect to Elasticsearch server')
        }
        if (error.message.includes('Authentication failed')) {
          throw new Error('Invalid Elasticsearch credentials')
        }
        if (error.message.includes('index_not_found')) {
          throw new Error(`Index "${index}" not found`)
        }
        if (error.message.includes('document_already_exists')) {
          throw new Error(`Document with ID "${id}" already exists`)
        }
      }
      throw error
    }

    return NextResponse.json({
      data: result,
      metadata: {
        operation,
        index,
        timestamp: new Date().toISOString(),
        connection: {
          node: connection.node,
          cloud: connection.cloud ? 'cloud' : 'local'
        }
      }
    })

  } catch (error) {
    console.error('Elasticsearch API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
} 