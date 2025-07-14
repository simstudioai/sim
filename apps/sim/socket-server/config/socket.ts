import type { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import { env } from '@/lib/env'
import { isProd } from '@/lib/environment'
import { createLogger } from '../../lib/logs/console-logger'

const logger = createLogger('SocketIOConfig')

/**
 * Get allowed origins for Socket.IO CORS configuration
 */
function getAllowedOrigins(): string[] {
  const allowedOrigins = [
    env.NEXT_PUBLIC_APP_URL,
    env.NEXT_PUBLIC_VERCEL_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    ...(env.ALLOWED_ORIGINS?.split(',') || []),
  ].filter((url): url is string => Boolean(url))

  logger.info('Socket.IO CORS configuration:', { allowedOrigins })

  return allowedOrigins
}

/**
 * Create and configure a Socket.IO server instance
 * @param httpServer - The HTTP server instance to attach Socket.IO to
 * @returns Configured Socket.IO server instance
 */
export function createSocketIOServer(httpServer: HttpServer): Server {
  const allowedOrigins = getAllowedOrigins()

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'socket.io'],
      credentials: true, // Enable credentials to accept cookies
    },
    transports: ['websocket', 'polling'], // WebSocket first, polling as fallback
    allowEIO3: true, // Keep legacy support for compatibility
    pingTimeout: 60000, // Back to original conservative setting
    pingInterval: 25000, // Back to original interval
    maxHttpBufferSize: 1e6,
    cookie: {
      name: 'io',
      path: '/',
      httpOnly: true,
      sameSite: 'none', // Required for cross-origin cookies
      secure: isProd, // HTTPS in production
    },
  })

  logger.info('Socket.IO server configured with:', {
    allowedOrigins: allowedOrigins.length,
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    cookieSecure: isProd,
    corsCredentials: true,
  })

  return io
}
