import { createServer } from 'http'
import { env } from '@/lib/env'
import { createLogger } from '../lib/logs/console-logger'
import { createSocketIOServer } from './config/socket'
import { setupAllHandlers } from './handlers'
import { type AuthenticatedSocket, authenticateSocket } from './middleware/auth'
import { RoomManager } from './rooms/manager'
import { createHttpHandler } from './routes/http'

const logger = createLogger('CollaborativeSocketServer')

// Enhanced server configuration - HTTP server will be configured with handler after all dependencies are set up
const httpServer = createServer()

const io = createSocketIOServer(httpServer)

// Initialize room manager after io is created
const roomManager = new RoomManager(io)

io.use(authenticateSocket)

const httpHandler = createHttpHandler(roomManager, logger)
httpServer.on('request', httpHandler)

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error)
  // Don't exit in production, just log
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

httpServer.on('error', (error) => {
  logger.error('HTTP server error:', error)
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

httpServer.on('request', (req, res) => {
  logger.info(`🌐 HTTP Request: ${req.method} ${req.url}`, {
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin,
    host: req.headers.host,
    timestamp: new Date().toISOString(),
  })
})

io.engine.on('connection_error', (err) => {
  logger.error('❌ Engine.IO Connection error:', {
    code: err.code,
    message: err.message,
    context: err.context,
    req: err.req
      ? {
          url: err.req.url,
          method: err.req.method,
          headers: err.req.headers,
        }
      : 'No request object',
  })
})

const PORT = Number(env.PORT || env.SOCKET_PORT || 3002)

logger.info('Starting Socket.IO server...', {
  port: PORT,
  nodeEnv: env.NODE_ENV,
  hasDatabase: !!env.DATABASE_URL,
  hasAuth: !!env.BETTER_AUTH_SECRET,
})

httpServer.listen(PORT, '0.0.0.0', () => {
  logger.info(`Socket.IO server running on port ${PORT}`)
  logger.info(`🏥 Health check available at: http://localhost:${PORT}/health`)
})

httpServer.on('error', (error) => {
  logger.error('❌ Server failed to start:', error)
  process.exit(1)
})

process.on('SIGINT', () => {
  logger.info('Shutting down Socket.IO server...')
  httpServer.close(() => {
    logger.info('Socket.IO server closed')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  logger.info('Shutting down Socket.IO server...')
  httpServer.close(() => {
    logger.info('Socket.IO server closed')
    process.exit(0)
  })
})
