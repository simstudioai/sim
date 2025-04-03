import { createClient } from 'redis'
import { NextResponse } from 'next/server'

// Redis connection pool
const redisClients = new Map<string, any>()

function getRedisClient(connection: any) {
  const key = `${connection.host}:${connection.port}:${connection.db || 0}`
  if (!redisClients.has(key)) {
    const client = createClient({
      socket: {
        host: connection.host,
        port: connection.port,
        tls: connection.tls ? false : undefined,
      },
      password: connection.password,
      username: connection.username,
      database: connection.db,
    })
    redisClients.set(key, client)
  }
  return redisClients.get(key)
}

export async function POST(request: Request) {
  try {
    const params = await request.json()
    const { connection, operation, key, pattern, value, ttl, channel, message, options } = params

    // Get or create Redis client
    const client = getRedisClient(connection)

    // Connect if not already connected
    if (!client.isOpen) {
      await client.connect()
    }

    let result
    try {
      switch (operation) {
        case 'get':
          result = await client.get(key)
          break

        case 'set':
          if (ttl) {
            result = await client.set(key, JSON.stringify(value), { EX: ttl })
          } else {
            result = await client.set(key, JSON.stringify(value))
          }
          break

        case 'delete':
          result = await client.del(key)
          break

        case 'keys':
          result = await client.keys(pattern)
          break

        case 'hget':
          result = await client.hGet(key, value)
          break

        case 'hset':
          result = await client.hSet(key, value)
          break

        case 'lpush':
          result = await client.lPush(key, JSON.stringify(value))
          break

        case 'lrange':
          result = await client.lRange(key, 0, -1)
          break

        case 'sadd':
          result = await client.sAdd(key, JSON.stringify(value))
          break

        case 'smembers':
          result = await client.sMembers(key)
          break

        case 'publish':
          result = await client.publish(channel, JSON.stringify(message))
          break

        case 'subscribe':
          const subscriber = client.duplicate()
          let subscriptionResult: string | null = null
          
          await subscriber.subscribe(channel, (message: string) => {
            subscriptionResult = message
          })
          
          result = {
            status: 'subscribed',
            channel,
            message: subscriptionResult
          }
          break

        default:
          throw new Error(`Unsupported operation: ${operation}`)
      }
    } catch (error) {
      // Handle specific Redis errors
      if (error instanceof Error) {
        if (error.message.includes('ECONNREFUSED')) {
          throw new Error('Could not connect to Redis server')
        }
        if (error.message.includes('WRONGPASS')) {
          throw new Error('Invalid Redis password')
        }
        if (error.message.includes('NOAUTH')) {
          throw new Error('Redis authentication required')
        }
      }
      throw error
    }

    return NextResponse.json({
      data: result,
      metadata: {
        operation,
        key,
        timestamp: new Date().toISOString(),
        connection: {
          host: connection.host,
          port: connection.port,
          db: connection.db
        }
      }
    })

  } catch (error) {
    console.error('Redis API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
} 