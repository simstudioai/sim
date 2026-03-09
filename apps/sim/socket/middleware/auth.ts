import { createLogger } from '@sim/logger'
import type { Socket } from 'socket.io'
import { auth } from '@/lib/auth'
import { ANONYMOUS_USER, ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { isAuthDisabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('SocketAuth')

/**
 * Authenticated socket with user data attached.
 */
export interface AuthenticatedSocket extends Socket {
  userId?: string
  userName?: string
  userEmail?: string
  activeOrganizationId?: string
  userImage?: string | null
}

/**
 * Socket.IO authentication middleware.
 * Handles both anonymous mode (DISABLE_AUTH=true) and normal token-based auth.
 */
export async function authenticateSocket(socket: AuthenticatedSocket, next: (err?: Error) => void) {
  try {
    if (isAuthDisabled) {
      socket.userId = ANONYMOUS_USER_ID
      socket.userName = ANONYMOUS_USER.name
      socket.userEmail = ANONYMOUS_USER.email
      socket.userImage = ANONYMOUS_USER.image
      logger.debug(`Socket ${socket.id} authenticated as anonymous`)
      return next()
    }

    // Extract authentication data from socket handshake
    const token = socket.handshake.auth?.token
    const origin = socket.handshake.headers.origin
    const referer = socket.handshake.headers.referer

    logger.info(`Socket ${socket.id} authentication attempt:`, {
      hasToken: !!token,
      origin,
      referer,
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
      socket.userImage = session.user.image || null
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
