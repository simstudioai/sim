import { ROOM_TYPES, type RoomType } from '@sim/realtime-protocol/rooms'
import { isPermissionType, type PermissionType, permissionSatisfies } from './predicates'

/**
 * Realtime room membership policy: which workspace permission a user must hold to
 * OCCUPY each room type, and the predicate that answers it.
 *
 * Deliberately its own dependency-free module (no DB client, no authorizer) so
 * every enforcement point can import it: the join-time check, the per-frame gates
 * on the hot relay paths, and the periodic access-revalidation sweep. One source of
 * truth means the join gate and the sweep can never drift — and that drift is
 * exactly what would let a downgraded member keep a room they could no longer join.
 */

/**
 * A file-doc room IS the collaborative editor, so occupying it requires `write`;
 * every other room carries only reads/presence and requires `read`. Workflow is
 * included for the sweep's benefit even though it authorizes through its own path
 * (`authorizeWorkflowByWorkspacePermission`).
 */
export const ROOM_MEMBERSHIP_ACTIONS = {
  [ROOM_TYPES.WORKFLOW]: 'read',
  [ROOM_TYPES.WORKSPACE_FILES]: 'read',
  [ROOM_TYPES.WORKSPACE_TABLES]: 'read',
  [ROOM_TYPES.WORKSPACE_FILE_DOC]: 'write',
  [ROOM_TYPES.TABLE]: 'read',
} as const satisfies Record<RoomType, PermissionType>

/**
 * Whether a resolved permission still entitles its holder to occupy a room of this
 * type. `null` (no access) never does.
 *
 * The parameter is `string` rather than {@link PermissionType} because the realtime
 * server carries roles as plain strings on presence records. A value outside the
 * known levels is treated as satisfying: roles originate from the DB enum, so an
 * unrecognized one means something upstream changed — and reading it as
 * "insufficient" would mass-evict live collaborators. Enforcement stays reserved
 * for a definitively known-insufficient permission.
 */
export function satisfiesRoomMembership(role: string | null | undefined, type: RoomType): boolean {
  if (role == null) return false
  if (!isPermissionType(role)) return true
  return permissionSatisfies(role, ROOM_MEMBERSHIP_ACTIONS[type])
}
