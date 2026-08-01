import type { createLogger } from '@sim/logger'
import { authorizeRoom } from '@sim/platform-authz/rooms'
import type { RoomRef } from '@sim/realtime-protocol/rooms'
import { recordRoomPermissionIfUnchanged, snapshotRoomPermission } from '@/middleware/permissions'

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
  // Captured before the query so a decision recorded WHILE it was in flight (the
  // access-revalidation sweep evicting this user) is never overwritten by this
  // older read — see {@link recordRoomPermissionIfUnchanged}.
  const snapshot = snapshotRoomPermission(userId, room)
  try {
    authorized = await authorizeRoom({ userId, room, action })
  } catch (error) {
    logger.warn(`Error authorizing ${logLabel}:`, error)
    emitError({ error: messages.verifyFailed, code: 'VERIFY_ACCESS_FAILED', retryable: true })
    return null
  }

  // Feed the fresh authoritative read into the shared role cache that the access
  // re-validation sweep and the per-frame write gates consult, so both start warm on
  // the room this socket just joined — and so a re-granted user's join immediately
  // supersedes a cached revocation instead of waiting out its TTL. A 400 (room type
  // not authorizable here) resolved no permission at all and is deliberately not
  // recorded. A 404 records `null`: the resource is genuinely gone.
  if (authorized.status !== 400) {
    recordRoomPermissionIfUnchanged(userId, room, authorized.workspacePermission, snapshot)
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
