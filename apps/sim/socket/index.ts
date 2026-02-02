import { createServer } from 'http'
import { createLogger } from '@sim/logger'
import type { Server as SocketIOServer } from 'socket.io'
import { env } from '@/lib/core/config/env'
import { createSocketIOServer, shutdownSocketIOAdapter } from '@/socket/config/socket'
import { setupAllHandlers } from '@/socket/handlers'
import { type AuthenticatedSocket, authenticateSocket } from '@/socket/middleware/auth'
import { type IRoomManager, MemoryRoomManager, RedisRoomManager } from '@/socket/rooms'
import { createHttpHandler } from '@/socket/routes/http'

const logger = createLogger('CollaborativeSocketServer')

/** Maximum time to wait for graceful shutdown before forcing exit */
const SHUTDOWN_TIMEOUT_MS = 10000

async function createRoomManager(io: SocketIOServer): Promise<IRoomManager> {
  if (env.REDIS_URL) {
    logger.info('Initializing Redis-backed RoomManager for multi-pod support')
    const manager = new RedisRoomManager(io, env.REDIS_URL)
    await manager.initialize()
    return manager
  }

  logger.warn('No REDIS_URL configured - using in-memory RoomManager (single-pod only)')
  const manager = new MemoryRoomManager(io)
  await manager.initialize()
  return manager
}

async function main() {
  const httpServer = createServer()
  const PORT = Number(env.PORT || env.SOCKET_PORT || 3002)

  logger.info('Starting Socket.IO server...', {
    port: PORT,
    nodeEnv: env.NODE_ENV,
    hasDatabase: !!env.DATABASE_URL,
    hasAuth: !!env.BETTER_AUTH_SECRET,
    hasRedis: !!env.REDIS_URL,
  })

  // Create Socket.IO server with Redis adapter if configured
  const io = await createSocketIOServer(httpServer)

  // Initialize room manager (Redis or in-memory based on config)
  const roomManager = await createRoomManager(io)

  // Set up authentication middleware
  io.use(authenticateSocket)

  // Set up HTTP handler for health checks and internal APIs
  const httpHandler = createHttpHandler(roomManager, logger)
  httpServer.on('request', httpHandler)

  // Global error handlers
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
  })

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    logger.error('HTTP server error:', error)
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      process.exit(1)
    }
  })

  io.engine.on('connection_error', (err) => {
    logger.error('Socket.IO connection error:', {
      req: err.req?.url,
      code: err.code,
      message: err.message,
      context: err.context,
    })
  })

  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`New socket connection: ${socket.id}`)
    setupAllHandlers(socket, roomManager)
  })

  httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info(`Socket.IO server running on port ${PORT}`)
    logger.info(`Health check available at: http://localhost:${PORT}/health`)
  })

  const shutdown = async () => {
    logger.info('Shutting down Socket.IO server...')

    try {
      await roomManager.shutdown()
      logger.info('RoomManager shutdown complete')
    } catch (error) {
      logger.error('Error during RoomManager shutdown:', error)
    }

    try {
      await shutdownSocketIOAdapter()
    } catch (error) {
      logger.error('Error during Socket.IO adapter shutdown:', error)
    }

    httpServer.close(() => {
      logger.info('Socket.IO server closed')
      process.exit(0)
    })

    setTimeout(() => {
      logger.error('Forced shutdown after timeout')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// Start the server
main().catch((error) => {
  logger.error('Failed to start server:', error)
  process.exit(1)
})
