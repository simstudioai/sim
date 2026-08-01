import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeRoom, type PermissionType } from '@sim/platform-authz/rooms'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import {
  BLOCK_OPERATIONS,
  BLOCKS_OPERATIONS,
  EDGE_OPERATIONS,
  EDGES_OPERATIONS,
  SUBBLOCK_OPERATIONS,
  SUBFLOW_OPERATIONS,
  VARIABLE_OPERATIONS,
  WORKFLOW_OPERATIONS,
} from '@sim/realtime-protocol/constants'
import { ROOM_TYPES, type RoomRef, roomName } from '@sim/realtime-protocol/rooms'
import { and, eq, isNull } from 'drizzle-orm'

const logger = createLogger('SocketPermissions')

// Admin-only operations (require admin role)
const ADMIN_ONLY_OPERATIONS: string[] = [BLOCKS_OPERATIONS.BATCH_TOGGLE_LOCKED]

// Write operations (admin and write roles both have these permissions)
const WRITE_OPERATIONS: string[] = [
  // Block operations
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCK_OPERATIONS.UPDATE_NAME,
  BLOCK_OPERATIONS.TOGGLE_ENABLED,
  BLOCK_OPERATIONS.UPDATE_PARENT,
  BLOCK_OPERATIONS.UPDATE_ADVANCED_MODE,
  BLOCK_OPERATIONS.UPDATE_CANONICAL_MODE,
  BLOCK_OPERATIONS.REPLACE_CANONICAL_MODES,
  BLOCK_OPERATIONS.TOGGLE_HANDLES,
  // Batch block operations
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
  BLOCKS_OPERATIONS.BATCH_ADD_BLOCKS,
  BLOCKS_OPERATIONS.BATCH_REMOVE_BLOCKS,
  BLOCKS_OPERATIONS.BATCH_TOGGLE_ENABLED,
  BLOCKS_OPERATIONS.BATCH_TOGGLE_HANDLES,
  BLOCKS_OPERATIONS.BATCH_UPDATE_PARENT,
  // Edge operations
  EDGE_OPERATIONS.ADD,
  EDGE_OPERATIONS.REMOVE,
  // Batch edge operations
  EDGES_OPERATIONS.BATCH_ADD_EDGES,
  EDGES_OPERATIONS.BATCH_REMOVE_EDGES,
  // Subflow operations
  SUBFLOW_OPERATIONS.UPDATE,
  // Subblock operations
  SUBBLOCK_OPERATIONS.UPDATE,
  SUBBLOCK_OPERATIONS.BATCH_UPDATE,
  // Variable operations
  VARIABLE_OPERATIONS.UPDATE,
  // Workflow operations
  WORKFLOW_OPERATIONS.REPLACE_STATE,
]

// Read role can only update positions (for cursor sync, etc.)
const READ_OPERATIONS: string[] = [
  BLOCK_OPERATIONS.UPDATE_POSITION,
  BLOCKS_OPERATIONS.BATCH_UPDATE_POSITIONS,
]

// Define operation permissions based on role
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [...ADMIN_ONLY_OPERATIONS, ...WRITE_OPERATIONS],
  write: WRITE_OPERATIONS,
  read: READ_OPERATIONS,
}

// Check if a role allows a specific operation (no DB query, pure logic)
export function checkRolePermission(
  role: string,
  operation: string
): { allowed: boolean; reason?: string } {
  const allowedOperations = ROLE_PERMISSIONS[role] || []

  if (!allowedOperations.includes(operation)) {
    return {
      allowed: false,
      reason: `Role '${role}' not permitted to perform '${operation}'`,
    }
  }

  return { allowed: true }
}

/**
 * TTL for the per-pod role cache backing live re-validation. It gates the
 * mutating-operation checks ({@link checkWorkflowOperationPermission}), the
 * per-frame room write gates (file-doc / tables), and the periodic access sweep
 * (`access-revalidation.ts`), so a revoked or downgraded collaborator loses write
 * access — and live reads — on an already-connected socket within a bounded
 * window rather than until disconnect.
 */
export const ROLE_REVALIDATION_TTL_MS = 30_000

/** Soft cap on cached entries before an opportunistic purge of expired ones runs. */
const MAX_ROLE_CACHE_ENTRIES = 5_000

interface CachedRole {
  /** Authoritative workspace role, or `null` when the user has no access. */
  role: string | null
  expiresAt: number
}

/**
 * Per-pod cache of authoritative workspace roles, keyed by
 * `${userId}:${roomName(room)}`.
 *
 * The key uses the wire room name, so a workflow entry is `${userId}:${workflowId}`
 * exactly as before (workflow rooms are unprefixed) while every other room type is
 * namespaced by its own `type:id` — a file-doc and a table can never collide on an
 * id, and one cache serves every room type.
 *
 * Socket connections are sticky to a single pod, so a socket's mutating operations are
 * always gated by the same pod's cache. We rely on TTL expiry (not cross-pod
 * invalidation) to bound stale authorization to {@link ROLE_REVALIDATION_TTL_MS}, which
 * keeps this correct under a multi-pod deployment without any shared state.
 */
const roleCache = new Map<string, CachedRole>()

/**
 * In-flight resolutions keyed like {@link roleCache}. Concurrent callers for the same
 * (user, room) share one authorization query instead of racing independent ones, so
 * cache writes per key are serialized — a slow, stale pre-revocation read can never
 * overwrite a newer recorded decision (e.g. the revocation the eviction sweep just
 * cached before kicking the socket).
 */
const inFlightRoleResolutions = new Map<string, Promise<string | null>>()

function roleCacheKey(userId: string, room: RoomRef): string {
  return `${userId}:${roomName(room)}`
}

function purgeExpiredRoles(now: number): void {
  for (const [key, entry] of roleCache) {
    if (entry.expiresAt <= now) {
      roleCache.delete(key)
    }
  }
}

/**
 * Records a freshly-read authoritative decision into the role cache. Every
 * successful DB read of a user's workspace role goes through this — including
 * the join-time {@link verifyWorkflowAccess} — so a stale cached revocation
 * never outlives a newer authoritative read (e.g. a re-granted user re-joining
 * within the TTL of the sweep's recorded `null`).
 */
function recordRoleDecision(key: string, role: string | null): void {
  const now = Date.now()
  if (roleCache.size >= MAX_ROLE_CACHE_ENTRIES) {
    purgeExpiredRoles(now)
  }
  roleCache.set(key, { role, expiresAt: now + ROLE_REVALIDATION_TTL_MS })
}

/**
 * Reads a user's authoritative effective workspace permission for a room, or
 * `null` when they have none. Workflow rooms go through their own dedicated
 * authorizer; every other room type resolves through the shared
 * {@link authorizeRoom} (resource → owning workspace → effective permission).
 *
 * Always asks for the LOWEST level (`read`) so the resolved permission itself is
 * returned rather than a boolean — callers compare it against whatever level the
 * operation needs with `permissionSatisfies`. A room type that is not
 * authorizable here (status 400) THROWS, so it lands in the caller's transient
 * branch and can never be mistaken for a confirmed revocation.
 */
async function readAuthoritativeRoomPermission(
  userId: string,
  room: RoomRef
): Promise<PermissionType | null> {
  if (room.type === ROOM_TYPES.WORKFLOW) {
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: room.id,
      userId,
      action: 'read',
    })
    return authorization.allowed ? (authorization.workspacePermission ?? null) : null
  }

  const authorization = await authorizeRoom({ userId, room, action: 'read' })
  if (!authorization.allowed && authorization.status === 400) {
    throw new Error(`Room type not authorizable: ${room.type}`)
  }
  return authorization.allowed ? (authorization.workspacePermission ?? null) : null
}

async function resolveRoleUncached(
  key: string,
  userId: string,
  room: RoomRef,
  fallbackRole: string
): Promise<string | null> {
  const entryBeforeQuery = roleCache.get(key)
  try {
    const role = await readAuthoritativeRoomPermission(userId, room)
    // A fresh authoritative read (e.g. a join-time verifyWorkflowAccess) may
    // have recorded a decision while this query was in flight. That write is
    // newer than this query's read snapshot, so prefer it instead of
    // overwriting it with a potentially stale result.
    const entryAfterQuery = roleCache.get(key)
    if (entryAfterQuery !== undefined && entryAfterQuery !== entryBeforeQuery) {
      return entryAfterQuery.role
    }
    recordRoleDecision(key, role)
    return role
  } catch (error) {
    logger.warn(
      `Failed to re-validate role for user ${userId} on ${roomName(room)}; using last known role`,
      error
    )
    // Prefer the last recorded decision — even if expired, and even if it is `null` for an
    // already-revoked user — so a recorded revocation survives a transient DB failure
    // instead of reverting to the stale join-time role. Only trust `fallbackRole` when
    // nothing has been recorded for this (user, workflow) yet.
    const lastKnown = roleCache.get(key)
    return lastKnown !== undefined ? lastKnown.role : fallbackRole
  }
}

/**
 * Resolves a user's current effective workspace permission for a room, re-reading the
 * `permissions` table at most once per {@link ROLE_REVALIDATION_TTL_MS} per pod.
 * Concurrent calls for the same (user, room) coalesce onto a single in-flight query
 * (single-flight), so out-of-order cache writes cannot resurrect revoked access.
 *
 * Returns `null` when the user genuinely has no access (removed/revoked, or the room's
 * resource is gone). On a transient DB failure it reuses the last recorded decision for
 * this (user, room) — including a previously recorded revocation (`null`) — and only
 * falls back to `fallbackRole` when no decision has been recorded yet, so a blip neither
 * blocks legitimate editors nor resurrects already-revoked access.
 */
export async function resolveCurrentRoomPermission(
  userId: string,
  room: RoomRef,
  fallbackRole: string
): Promise<string | null> {
  const key = roleCacheKey(userId, room)
  const cached = roleCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.role
  }

  const inFlight = inFlightRoleResolutions.get(key)
  if (inFlight) {
    return inFlight
  }

  const resolution = resolveRoleUncached(key, userId, room, fallbackRole).finally(() => {
    inFlightRoleResolutions.delete(key)
  })
  inFlightRoleResolutions.set(key, resolution)
  return resolution
}

/**
 * Workflow-room specialization of {@link resolveCurrentRoomPermission}, kept as the
 * name the workflow operation/join paths already use.
 */
export function resolveCurrentWorkflowRole(
  userId: string,
  workflowId: string,
  fallbackRole: string
): Promise<string | null> {
  return resolveCurrentRoomPermission(
    userId,
    { type: ROOM_TYPES.WORKFLOW, id: workflowId },
    fallbackRole
  )
}

/**
 * Non-blocking read of the cached permission for a (user, room).
 *
 * Returns `undefined` when nothing fresh is cached — the caller must NOT read that
 * as a denial; it means "unknown, ask asynchronously". Exists for the per-frame
 * gates on hot relay paths (Yjs document frames, table cell selections), which must
 * stay synchronous: awaiting an authorization promise per keystroke would put a
 * microtask between every frame and its apply. Freshness is bounded by the same
 * {@link ROLE_REVALIDATION_TTL_MS}, and the periodic sweep independently evicts a
 * revoked socket, so a gate built on this is never the only line of defense.
 */
export function peekRoomPermission(userId: string, room: RoomRef): string | null | undefined {
  const cached = roleCache.get(roleCacheKey(userId, room))
  if (!cached || cached.expiresAt <= Date.now()) return undefined
  return cached.role
}

/**
 * Records an authoritative decision read outside this module (the room join
 * authorizer) into the shared cache, so the sweep and the per-frame gates start
 * warm and a re-granted user is never held out by a stale cached revocation.
 *
 * Unconditional: the caller's read is taken as the newest word. Use
 * {@link recordRoomPermissionIfUnchanged} when the read was slow enough that a
 * newer decision could have landed meanwhile.
 */
export function recordRoomPermission(
  userId: string,
  room: RoomRef,
  permission: PermissionType | null
): void {
  recordRoleDecision(roleCacheKey(userId, room), permission)
}

/** Opaque token identifying the cache entry a caller observed before its query. */
export type RoomPermissionSnapshot = object | undefined

/** Captures the current cache entry for a (user, room), for {@link recordRoomPermissionIfUnchanged}. */
export function snapshotRoomPermission(userId: string, room: RoomRef): RoomPermissionSnapshot {
  return roleCache.get(roleCacheKey(userId, room))
}

/**
 * Records an authoritative decision only if no other decision landed since
 * `snapshot` was taken.
 *
 * Without this, a join whose authorization query started before a revocation but
 * returned after the sweep recorded that revocation would overwrite it with its own
 * stale "allowed", handing the socket another full TTL of access. Entry identity
 * (not a timestamp) is the comparison, mirroring the in-flight ordering guard the
 * cached resolver already applies to its own queries — so it is exact regardless of
 * how many writes land inside one millisecond.
 */
export function recordRoomPermissionIfUnchanged(
  userId: string,
  room: RoomRef,
  permission: PermissionType | null,
  snapshot: RoomPermissionSnapshot
): void {
  const key = roleCacheKey(userId, room)
  if (roleCache.get(key) !== snapshot) return
  recordRoleDecision(key, permission)
}

/**
 * Live permission gate for mutating socket operations. Re-validates the user's workspace
 * role against the database (cached per pod for {@link ROLE_REVALIDATION_TTL_MS}) so that
 * revoked or downgraded collaborators lose write access on an open connection without
 * needing to rejoin the workflow.
 */
export async function checkWorkflowOperationPermission(
  userId: string,
  workflowId: string,
  operation: string,
  fallbackRole: string
): Promise<{ allowed: boolean; reason?: string; role: string | null }> {
  const role = await resolveCurrentWorkflowRole(userId, workflowId, fallbackRole)
  if (!role) {
    return {
      allowed: false,
      reason: 'Access to this workflow has been revoked',
      role: null,
    }
  }
  return { ...checkRolePermission(role, operation), role }
}

/**
 * Verifies a user's access to a workflow via workspace permissions.
 *
 * Returns `hasAccess: false` only for genuine denials (workflow missing/archived
 * or no workspace permission). Transient failures (DB errors) are rethrown so the
 * caller can report them as retryable instead of a permanent access denial.
 *
 * The fresh authorization decision is recorded into the role cache, so the
 * pre-join re-check and the eviction sweep see it immediately — in particular,
 * a user whose access was revoked and then restored is not blocked by the
 * sweep's stale cached revocation for the remainder of its TTL.
 */
export async function verifyWorkflowAccess(
  userId: string,
  workflowId: string
): Promise<{ hasAccess: boolean; role?: string; workspaceId?: string }> {
  try {
    const workflowData = await db
      .select({
        workspaceId: workflow.workspaceId,
        name: workflow.name,
      })
      .from(workflow)
      .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
      .limit(1)

    if (!workflowData.length) {
      logger.warn(`Workflow ${workflowId} not found`)
      return { hasAccess: false }
    }

    const { workspaceId, name: workflowName } = workflowData[0]
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId,
      action: 'read',
    })

    recordRoleDecision(
      roleCacheKey(userId, { type: ROOM_TYPES.WORKFLOW, id: workflowId }),
      authorization.allowed ? (authorization.workspacePermission ?? null) : null
    )

    if (!authorization.allowed || !authorization.workspacePermission) {
      logger.warn(
        `User ${userId} is not permitted to access workflow ${workflowId}: ${authorization.message}`
      )
      return { hasAccess: false }
    }

    logger.debug(
      `User ${userId} has ${authorization.workspacePermission} access to workflow ${workflowId} (${workflowName}) via workspace ${workspaceId}`
    )
    return {
      hasAccess: true,
      role: authorization.workspacePermission,
      workspaceId: workspaceId || undefined,
    }
  } catch (error) {
    logger.error(
      `Error verifying workflow access for user ${userId}, workflow ${workflowId}:`,
      error
    )
    throw error
  }
}
