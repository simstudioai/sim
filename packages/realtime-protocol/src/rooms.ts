/**
 * Room identity for the realtime layer.
 *
 * A {@link RoomRef} is the universal address shared by every realtime mechanism
 * in Sim — the Socket.IO presence server (`apps/realtime`), the durable SSE
 * event log, and the ephemeral pub/sub fanout. Each mechanism encodes a room
 * differently on the wire, but they all agree on this `{ type, id }` identity
 * and authorize it through the same workspace-permission resolver
 * (`@sim/platform-authz/rooms`).
 *
 * This module is pure (no runtime dependencies) so both `apps/sim` and
 * `apps/realtime` can import it.
 */

/**
 * The kinds of realtime room. Each value is a stable wire token — changing one
 * is a breaking protocol change (it renames Socket.IO rooms and Redis keys), so
 * treat these like enum values that ship to clients.
 */
export const ROOM_TYPES = {
  /** The collaborative workflow editor canvas (one room per workflow). */
  WORKFLOW: 'workflow',
  /** The workspace file browser (one room per workspace). */
  WORKSPACE_FILES: 'workspace-files',
  PROJECT_FILES: 'project-files',
  /**
   * A single collaborative file document — the rich-text editor for one file
   * (one room per file). Carries Yjs document sync + awareness (live carets and
   * text selection), so its id space is the file id, distinct from the
   * workspace-scoped {@link ROOM_TYPES.WORKSPACE_FILES} browser room.
   */
  WORKSPACE_FILE_DOC: 'workspace-file-doc',
  PROJECT_FILE_DOC: 'project-file-doc',
  /**
   * A single table's grid (one room per table). Carries live cell-selection
   * presence — which cells each viewer has selected — so its id space is the
   * table id.
   */
  TABLE: 'table',
  /**
   * The workspace tables browser (one room per workspace). The list-level
   * counterpart to {@link ROOM_TYPES.TABLE}: it carries NO presence, only a
   * lossy `workspace-tables-changed` invalidation signal so every viewer's
   * tables list refetches when a table is created/renamed/moved/deleted. Its id
   * space is the workspace id, mirroring {@link ROOM_TYPES.WORKSPACE_FILES}.
   */
  WORKSPACE_TABLES: 'workspace-tables',
  /**
   * The workspace workflow registry (one room per workspace). The list-level
   * counterpart to {@link ROOM_TYPES.WORKFLOW}: it carries NO presence, only a
   * lossy `workspace-workflows-changed` invalidation signal so every viewer's
   * sidebar workflow list (and workflow folder tree) refetches when a workflow
   * or workflow folder is created/renamed/moved/deleted/restored — including
   * mutations from other surfaces (CLI, copilot, API). Its id space is the
   * workspace id, mirroring {@link ROOM_TYPES.WORKSPACE_TABLES}.
   */
  WORKSPACE_WORKFLOWS: 'workspace-workflows',
} as const

export type RoomType = (typeof ROOM_TYPES)[keyof typeof ROOM_TYPES]

/** Every known room type, for exhaustive iteration/validation. */
const ALL_ROOM_TYPES = Object.values(ROOM_TYPES) as readonly RoomType[]

/**
 * The presence-free, workspace-scoped live-list rooms. They share one contract derived entirely
 * from the room-type token: clients join via `join-${type}`, the app server fans a mutation out via
 * `POST /api/${type}-changed`, and members receive a lossy `${type}-changed` invalidation signal.
 * Adding a room type here wires it into the shared socket handler and HTTP relay branch.
 */
export const WORKSPACE_LIST_ROOM_TYPES = [
  ROOM_TYPES.WORKSPACE_FILES,
  ROOM_TYPES.WORKSPACE_TABLES,
  ROOM_TYPES.WORKSPACE_WORKFLOWS,
] as const

/** Owner-specific wire addresses share the same presence-free invalidation lifecycle. */
const INVALIDATION_ROOM_ID_KEYS = {
  [ROOM_TYPES.WORKSPACE_FILES]: 'workspaceId',
  [ROOM_TYPES.WORKSPACE_TABLES]: 'workspaceId',
  [ROOM_TYPES.WORKSPACE_WORKFLOWS]: 'workspaceId',
  [ROOM_TYPES.PROJECT_FILES]: 'projectId',
} as const

export type InvalidationRoomType = keyof typeof INVALIDATION_ROOM_ID_KEYS

export const INVALIDATION_ROOM_TYPES = Object.keys(
  INVALIDATION_ROOM_ID_KEYS
) as InvalidationRoomType[]

/** Legacy workspace callers keep their payload key; unsupported rooms never inherit it. */
export function invalidationRoomIdKey(type: RoomType): 'workspaceId' | 'projectId' {
  if (!Object.hasOwn(INVALIDATION_ROOM_ID_KEYS, type)) {
    throw new Error('Room does not support list invalidation')
  }
  return INVALIDATION_ROOM_ID_KEYS[type as InvalidationRoomType]
}

/** Universal address of a realtime room. */
export interface RoomRef {
  type: RoomType
  id: string
}

const ROOM_AUTHORIZATION_OWNERS = {
  [ROOM_TYPES.WORKFLOW]: 'workspace',
  [ROOM_TYPES.WORKSPACE_FILES]: 'workspace',
  [ROOM_TYPES.WORKSPACE_TABLES]: 'workspace',
  [ROOM_TYPES.WORKSPACE_WORKFLOWS]: 'workspace',
  [ROOM_TYPES.WORKSPACE_FILE_DOC]: 'workspace',
  [ROOM_TYPES.TABLE]: 'workspace',
  [ROOM_TYPES.PROJECT_FILE_DOC]: 'project',
  [ROOM_TYPES.PROJECT_FILES]: 'project',
} as const satisfies Record<RoomType, 'workspace' | 'project'>

export type ProjectRoomRef = RoomRef & {
  type: typeof ROOM_TYPES.PROJECT_FILE_DOC | typeof ROOM_TYPES.PROJECT_FILES
}

/** Every room declares the authority that both admission and revalidation must consult. */
export function isProjectRoom(room: RoomRef): room is ProjectRoomRef {
  return ROOM_AUTHORIZATION_OWNERS[room.type] === 'project'
}

/** Type guard: whether an arbitrary string is a known {@link RoomType}. */
function isRoomType(value: string): value is RoomType {
  return (ALL_ROOM_TYPES as readonly string[]).includes(value)
}

/**
 * The Socket.IO room name (and default key segment) for a room.
 *
 * `WORKFLOW` maps to the **bare id** — deliberately. The workflow editor has
 * ~40 existing `io.to(workflowId)` / `socket.join(workflowId)` callsites that
 * pass the bare workflow id, plus stale-cleanup that cross-references
 * `io.in(workflowId).fetchSockets()` against Redis presence state. Preserving
 * the bare name keeps every one of those callsites correct with zero diff and
 * zero presence-state migration. Every *other* room type is namespaced
 * (`${type}:${id}`) so a new id space can never collide with a workflow UUID.
 *
 * The inverse ({@link parseRoomName}) relies on this: an unprefixed name is a
 * workflow, a prefixed name splits on the first `:`.
 *
 * Precondition: room ids are opaque tokens that never contain `:` — satisfied by
 * every id in Sim (`generateId()` UUIDs, `generateShortId()` URL-safe tokens,
 * workspace ids). This is what makes a bare workflow id unambiguous against a
 * `${type}:${id}` namespace and keeps {@link parseRoomName} lossless.
 */
export function roomName(room: RoomRef): string {
  return room.type === ROOM_TYPES.WORKFLOW ? room.id : `${room.type}:${room.id}`
}

/**
 * Inverse of {@link roomName}. A name carrying a known `${type}:` prefix parses
 * to that type; any other (unprefixed) name is a {@link ROOM_TYPES.WORKFLOW}
 * room whose id is the whole string — see {@link roomName} for why workflow is
 * unprefixed. Returns `null` only for the empty string.
 */
export function parseRoomName(name: string): RoomRef | null {
  if (!name) return null

  const separatorIndex = name.indexOf(':')
  if (separatorIndex > 0) {
    const maybeType = name.slice(0, separatorIndex)
    if (isRoomType(maybeType) && maybeType !== ROOM_TYPES.WORKFLOW) {
      return { type: maybeType, id: name.slice(separatorIndex + 1) }
    }
  }

  return { type: ROOM_TYPES.WORKFLOW, id: name }
}

/**
 * The `presence-update` broadcast event name for a room type. `WORKFLOW` keeps
 * the historical bare `presence-update` name (client backward-compat); every
 * other type is namespaced so a socket joined to more than one room can tell the
 * presence streams apart on a single connection.
 */
export function presenceEventName(type: RoomType): string {
  return type === ROOM_TYPES.WORKFLOW ? 'presence-update' : `${type}:presence-update`
}

/** Owner-qualified identity for shared Project document rooms. */
export function projectFileDocRoom(projectId: string, fileId: string): RoomRef {
  if (![projectId, fileId].every((id) => id.length > 0 && !/[/:]/.test(id))) {
    throw new Error('Invalid Project document identity')
  }
  return { type: ROOM_TYPES.PROJECT_FILE_DOC, id: `${projectId}/${fileId}` }
}

/** Resolve the exact owner and file encoded in a Project room address. */
export function projectFileDocTarget(room: RoomRef): { projectId: string; fileId: string } | null {
  if (room.type !== ROOM_TYPES.PROJECT_FILE_DOC) return null
  const parts = room.id.split('/')
  if (parts.length !== 2 || parts.some((id) => !id || id.includes(':'))) return null
  return { projectId: parts[0], fileId: parts[1] }
}
