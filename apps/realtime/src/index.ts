import { createServer } from 'http'
import { createLogger } from '@sim/logger'
import type { Server as SocketIOServer } from 'socket.io'
import { startAccessRevalidationSweep } from '@/access-revalidation'
import { createSocketIOServer, shutdownSocketIOAdapter } from '@/config/socket'
import { assertSchemaCompatibility } from '@/database/preflight'
import { env } from '@/env'
import { setupAllHandlers } from '@/handlers'
import { flushAllFileDocRooms } from '@/handlers/file-doc'
import { getFileDocStore, initFileDocStore } from '@/handlers/file-doc-store'
import { type AuthenticatedSocket, authenticateSocket } from '@/middleware/auth'
import { type IRoomManager, MemoryRoomManager, RedisRoomManager } from '@/rooms'
import { createHttpHandler } from '@/routes/http'

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
  const PORT = env.PORT

  logger.info('Starting Socket.IO server...', {
    port: PORT,
    nodeEnv: env.NODE_ENV,
    hasDatabase: !!env.DATABASE_URL,
    hasAuth: !!env.BETTER_AUTH_SECRET,
    hasRedis: !!env.REDIS_URL,
  })

  // Register the HTTP handler before Socket.IO attaches: engine.io captures
  // pre-existing `request` listeners and forwards only non-`/socket.io/`
  // requests to them, making it the single dispatcher for the shared port.
  // The handler itself is assigned after the room manager exists, before listen().
  // biome-ignore lint/style/useConst: must be declared before the request listener closure; assigned only after the room manager exists
  let httpHandler: ReturnType<typeof createHttpHandler> | undefined
  httpServer.on('request', (req, res) => httpHandler?.(req, res))

  // Create Socket.IO server with Redis adapter if configured
  const io = await createSocketIOServer(httpServer)

  // Initialize room manager (Redis or in-memory based on config)
  const roomManager = await createRoomManager(io)

  // Initialize the shared Yjs backend for collaborative file docs (Redis Streams). Enabled only when
  // REDIS_URL is set; otherwise the relay runs its original single-replica in-memory doc path.
  await initFileDocStore(env.REDIS_URL)

  // Set up authentication middleware
  io.use(authenticateSocket)

  // Set up HTTP handler for health checks and internal APIs
  httpHandler = createHttpHandler(roomManager, logger)

  // Global error handlers
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    if (reason instanceof Error && reason.message === 'The client is closed') {
      logger.warn('Redis client is closed — suppressing unhandled rejection')
      return
    }
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

  // Bound read-access staleness: periodically re-validate connected sockets and
  // evict any whose workspace permission has been revoked, matching the write path.
  const accessRevalidation = startAccessRevalidationSweep(roomManager)

  await assertSchemaCompatibility()

  httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info(`Socket.IO server running on port ${PORT}`)
    logger.info(`Health check available at: http://localhost:${PORT}/health`)
  })

  let shuttingDown = false
  const shutdown = async () => {
    // SIGINT and SIGTERM both bind this; a double signal (or SIGTERM then SIGINT during the drain)
    // must not run the whole teardown twice — that means a second forced-exit timer and a second
    // Redis quit (which throws "The client is closed").
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Shutting down Socket.IO server...')

    accessRevalidation.stop()

    // Flush open collaborative docs to durable markdown BEFORE tearing down Redis/the store — the
    // per-socket disconnect flush is fire-and-forget and would race process exit.
    try {
      await flushAllFileDocRooms()
      logger.info('Flushed open collaborative documents')
    } catch (error) {
      logger.error('Error flushing collaborative documents on shutdown:', error)
    }

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

    try {
      await getFileDocStore().shutdown()
    } catch (error) {
      logger.error('Error during FileDocStore shutdown:', error)
    }

    // Close local client connections so `httpServer.close()` can complete its callback and exit
    // gracefully — otherwise open websockets keep it hanging until the forced-exit timer below.
    // Local-only: a rolling deploy must not disconnect clients pinned to other pods.
    try {
      io.local.disconnectSockets(true)
    } catch (error) {
      logger.error('Error disconnecting sockets on shutdown:', error)
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
