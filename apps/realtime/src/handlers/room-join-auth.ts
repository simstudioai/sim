import type { createLogger } from '@sim/logger'
import { authorizeRoom } from '@sim/platform-authz/rooms'
import type { RoomRef } from '@sim/realtime-protocol/rooms'

type Authorized = Awaited<ReturnType<typeof authorizeRoom>>

interface ResolveRoomJoinAuthParams {
  userId: string
  room: RoomRef
  action: 'read' | 'write'
  logger: ReturnType<typeof createLogger>
  /** Included in the warn log on an authorize throw, e.g. `table room for ${userId}`. */
  logLabel: string
  messages: { verifyFailed: string; notFound: string; accessDenied: string }
  /** Emits the handler's own JOIN_ERROR shape (event name + id key differ per handler). */
  emitError: (args: { error: string; code: string; retryable: boolean }) => void
}

/**
 * Runs the shared authorize→allowed slice of a room join: authorizes the room and checks
 * the result, emitting the handler-specific JOIN_ERROR on failure. Returns the authorized
 * result on success, or `null` when it has already emitted an error and the caller must return.
 *
 * Deliberately excludes the auth/readiness/id-validation preamble and the join-generation
 * capture/recheck — those differ per handler, and for file-doc the generation capture sits
 * mid-preamble. This helper is always invoked strictly between a handler's generation capture
 * and its post-authorize recheck; it contains exactly the one `await authorizeRoom` that the
 * recheck was designed to cover and returns before any state mutation, so it never straddles
 * that seam. Pass each handler's own `logger` so the log namespace/request-id context is kept.
 */
export async function resolveRoomJoinAuth(
  params: ResolveRoomJoinAuthParams
): Promise<Authorized | null> {
  const { userId, room, action, logger, logLabel, messages, emitError } = params

  let authorized: Authorized
  try {
    authorized = await authorizeRoom({ userId, room, action })
  } catch (error) {
    logger.warn(`Error authorizing ${logLabel}:`, error)
    emitError({ error: messages.verifyFailed, code: 'VERIFY_ACCESS_FAILED', retryable: true })
    return null
  }

  if (!authorized.allowed) {
    emitError({
      error: authorized.status === 404 ? messages.notFound : messages.accessDenied,
      code: authorized.status === 404 ? 'NOT_FOUND' : 'ACCESS_DENIED',
      retryable: false,
    })
    return null
  }

  return authorized
}
