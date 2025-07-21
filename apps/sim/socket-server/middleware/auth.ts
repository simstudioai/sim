import type { Socket } from 'socket.io'
import { auth } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SocketAuth')

// Extend Socket interface to include user data
export interface AuthenticatedSocket extends Socket {
  userId?: string
  userName?: string
  userEmail?: string
  activeOrganizationId?: string
}

// Enhanced authentication middleware
export async function authenticateSocket(socket: AuthenticatedSocket, next: any) {
  try {
    // Extract authentication data from socket handshake
    const token = socket.handshake.auth?.token
    const origin = socket.handshake.headers.origin
    const referer = socket.handshake.headers.referer

    logger.info(`Socket ${socket.id} authentication attempt:`, {
      hasToken: !!token,
      origin,
      referer,
      allHeaders: Object.keys(socket.handshake.headers),
    })

    if (!token) {
      logger.warn(`Socket ${socket.id} rejected: No authentication token found`)
      return next(new Error('Authentication required'))
    }

    // Validate one-time token with Better Auth
    try {
      logger.debug(`Attempting token validation for socket ${socket.id}`, {
        tokenLength: token?.length || 0,
        origin,
      })

      const session = await auth.api.verifyOneTimeToken({
        body: {
          token,
        },
      })

      if (!session?.user?.id) {
        logger.warn(`Socket ${socket.id} rejected: Invalid token - no user found`)
        return next(new Error('Invalid session'))
      }

      // Store user info in socket for later use
      socket.userId = session.user.id
      socket.userName = session.user.name || session.user.email || 'Unknown User'
      socket.userEmail = session.user.email
      socket.activeOrganizationId = session.session.activeOrganizationId || undefined

      next()
    } catch (tokenError) {
      const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError)
      const errorStack = tokenError instanceof Error ? tokenError.stack : undefined

      logger.warn(`Token validation failed for socket ${socket.id}:`, {
        error: errorMessage,
        stack: errorStack,
        origin,
        referer,
      })
      return next(new Error('Token validation failed'))
    }
  } catch (error) {
    logger.error(`Socket authentication error for ${socket.id}:`, error)
    next(new Error('Authentication failed'))
  }
}
