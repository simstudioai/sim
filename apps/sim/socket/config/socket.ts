import type { Server as HttpServer } from 'http'
import { createLogger } from '@sim/logger'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient, type RedisClientType } from 'redis'
import { Server } from 'socket.io'
import { env } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('SocketIOConfig')

/** Socket.IO ping timeout - how long to wait for pong before considering connection dead */
const PING_TIMEOUT_MS = 60000
/** Socket.IO ping interval - how often to send ping packets */
const PING_INTERVAL_MS = 25000
/** Maximum HTTP buffer size for Socket.IO messages */
const MAX_HTTP_BUFFER_SIZE = 1e6

let adapterPubClient: RedisClientType | null = null
let adapterSubClient: RedisClientType | null = null

function getAllowedOrigins(): string[] {
  const allowedOrigins = [
    getBaseUrl(),
    'http://localhost:3000',
    'http://localhost:3001',
    ...(env.ALLOWED_ORIGINS?.split(',') || []),
  ].filter((url): url is string => Boolean(url))

  logger.info('Socket.IO CORS configuration:', { allowedOrigins })

  return allowedOrigins
}

/**
 * Create and configure a Socket.IO server instance.
 * If REDIS_URL is configured, adds Redis adapter for cross-pod broadcasting.
 */
export async function createSocketIOServer(httpServer: HttpServer): Promise<Server> {
  const allowedOrigins = getAllowedOrigins()

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'socket.io'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: PING_TIMEOUT_MS,
    pingInterval: PING_INTERVAL_MS,
    maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
    cookie: {
      name: 'io',
      path: '/',
      httpOnly: true,
      sameSite: 'none',
      secure: isProd,
    },
  })

  if (env.REDIS_URL) {
    logger.info('Configuring Socket.IO Redis adapter...')

    const redisOptions = {
      url: env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            logger.error('Redis adapter reconnection failed after 10 attempts')
            return new Error('Redis adapter reconnection failed')
          }
          const delay = Math.min(retries * 100, 3000)
          logger.warn(`Redis adapter reconnecting in ${delay}ms (attempt ${retries})`)
          return delay
        },
      },
    }

    // Create separate clients for pub and sub (recommended for reliability)
    adapterPubClient = createClient(redisOptions)
    adapterSubClient = createClient(redisOptions)

    adapterPubClient.on('error', (err) => {
      logger.error('Redis adapter pub client error:', err)
    })

    adapterSubClient.on('error', (err) => {
      logger.error('Redis adapter sub client error:', err)
    })

    adapterPubClient.on('ready', () => {
      logger.info('Redis adapter pub client ready')
    })

    adapterSubClient.on('ready', () => {
      logger.info('Redis adapter sub client ready')
    })

    await Promise.all([adapterPubClient.connect(), adapterSubClient.connect()])

    io.adapter(createAdapter(adapterPubClient, adapterSubClient))

    logger.info('Socket.IO Redis adapter connected - cross-pod broadcasting enabled')
  } else {
    logger.warn('REDIS_URL not configured - running in single-pod mode')
  }

  logger.info('Socket.IO server configured with:', {
    allowedOrigins: allowedOrigins.length,
    transports: ['websocket', 'polling'],
    pingTimeout: PING_TIMEOUT_MS,
    pingInterval: PING_INTERVAL_MS,
    maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
    cookieSecure: isProd,
    corsCredentials: true,
    redisAdapter: !!env.REDIS_URL,
  })

  return io
}

/**
 * Clean up Redis adapter connections.
 * Call this during graceful shutdown.
 */
export async function shutdownSocketIOAdapter(): Promise<void> {
  const closePromises: Promise<void>[] = []

  if (adapterPubClient) {
    closePromises.push(
      adapterPubClient.quit().then(() => {
        logger.info('Redis adapter pub client closed')
        adapterPubClient = null
      })
    )
  }

  if (adapterSubClient) {
    closePromises.push(
      adapterSubClient.quit().then(() => {
        logger.info('Redis adapter sub client closed')
        adapterSubClient = null
      })
    )
  }

  if (closePromises.length > 0) {
    await Promise.all(closePromises)
    logger.info('Socket.IO Redis adapter shutdown complete')
  }
}
