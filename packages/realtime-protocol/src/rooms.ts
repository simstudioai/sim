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
  /**
   * A single collaborative file document — the rich-text editor for one file
   * (one room per file). Carries Yjs document sync + awareness (live carets and
   * text selection), so its id space is the file id, distinct from the
   * workspace-scoped {@link ROOM_TYPES.WORKSPACE_FILES} browser room.
   */
  WORKSPACE_FILE_DOC: 'workspace-file-doc',
} as const

export type RoomType = (typeof ROOM_TYPES)[keyof typeof ROOM_TYPES]

/** Every known room type, for exhaustive iteration/validation. */
export const ALL_ROOM_TYPES = Object.values(ROOM_TYPES) as readonly RoomType[]

/** Universal address of a realtime room. */
export interface RoomRef {
  type: RoomType
  id: string
}

/** Type guard: whether an arbitrary string is a known {@link RoomType}. */
export function isRoomType(value: string): value is RoomType {
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

/** Whether two room refs address the same room. */
export function isSameRoom(a: RoomRef, b: RoomRef): boolean {
  return a.type === b.type && a.id === b.id
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
