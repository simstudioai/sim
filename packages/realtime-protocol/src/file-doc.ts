/**
 * Wire protocol for the collaborative file-document room
 * ({@link ROOM_TYPES.WORKSPACE_FILE_DOC}). Live carets and text selection ride
 * Yjs document sync + awareness over the shared Socket.IO connection. These are
 * the event names, binary message tags, and join payloads that the server
 * (`apps/realtime/src/handlers/file-doc.ts`) and the client provider
 * (`apps/sim/.../file-doc`) must agree on exactly — the single source of truth
 * for both sides so they can never drift.
 *
 * The binary channel uses the standard Yjs "websocket" framing: every
 * {@link FILE_DOC_EVENTS.MESSAGE} payload is a `Uint8Array` whose first varUint
 * is a {@link FILE_DOC_MESSAGE_TYPE} tag (sync protocol vs awareness protocol),
 * so the client provider can reuse `y-protocols` verbatim.
 */

/** Socket.IO event names for the file-document collaboration channel. */
export const FILE_DOC_EVENTS = {
  /** Client → server: join a file's collaborative session ({@link JoinFileDocPayload}). */
  JOIN: 'join-file-doc',
  /** Server → client: join accepted ({@link JoinFileDocSuccess}). */
  JOIN_SUCCESS: 'join-file-doc-success',
  /** Server → client: join rejected ({@link JoinFileDocError}). */
  JOIN_ERROR: 'join-file-doc-error',
  /** Client → server: leave the session ({@link LeaveFileDocPayload}). */
  LEAVE: 'leave-file-doc',
  /** Both directions: a framed Yjs message (binary), tagged by {@link FILE_DOC_MESSAGE_TYPE}. */
  MESSAGE: 'file-doc-message',
  /**
   * Server → client: the roster of collaborators currently in the document
   * ({@link FileDocPresence}), for the avatar stack. Identity is server-authenticated (from
   * each socket's session), so — unlike the client-set awareness `user` field — a peer
   * cannot spoof or suppress another user's entry. Re-sent on every join and leave.
   */
  PRESENCE: 'file-doc-presence',
} as const

/**
 * The tag carried in the first varUint of a {@link FILE_DOC_EVENTS.MESSAGE}
 * payload — the standard Yjs websocket framing distinguishing a document-sync
 * message from an awareness (cursor/selection) message.
 */
export const FILE_DOC_MESSAGE_TYPE = {
  SYNC: 0,
  AWARENESS: 1,
} as const

export type FileDocMessageType = (typeof FILE_DOC_MESSAGE_TYPE)[keyof typeof FILE_DOC_MESSAGE_TYPE]

/**
 * Where "the document's initial content has been seeded" is recorded, stored inside the Yjs
 * document as `doc.getMap(configMap).get(flag) === true`. It lives in the CRDT so it merges across
 * clients; the client reads it as half of its readiness gate (`synced && initialContentLoaded`).
 *
 * The server seeds authoritatively: it builds the document from the file's stored markdown and sets
 * this flag in the SAME update, so a seeded document arrives content-and-flag together and the
 * client needs no seed handshake. `configMap` is a reserved top-level Y.Map name; the editor must
 * not use a top-level type of the same name (TipTap uses `getXmlFragment('default')`, no collision).
 *
 * Consumer (editor hook) contract:
 * 1. **Never overwrite content with an unseeded doc.** The markdown-mirror autosave MUST be gated on
 *    the document being both synced AND seeded — otherwise an empty/still-syncing doc could be saved
 *    over the real file (the one true data-loss path).
 * 2. **One provider per socket.** Destroy the previous provider before creating the next (document
 *    switch), so a stale provider's binary-frame listener can't apply another document's updates.
 * 3. **Treat a fatal (`retryable: false`) join error as terminal.** Latch it and fall back to a
 *    read-only view of the file's stored content — do not keep rejoining. The server auto-reclaims a
 *    same-user client-id collision silently (the reconnecting socket succeeds), so `CLIENT_ID_IN_USE`
 *    surfaces to a client only for the rare case of a *different* user colliding on the same random
 *    Yjs `clientID`; a page reload mints a new id and recovers.
 */
export const FILE_DOC_SEED = {
  configMap: 'config',
  flag: 'initialContentLoaded',
  /**
   * The file's raw YAML frontmatter string, stored in the config map so it lives in the CRDT and
   * merges across clients. The collaborative document body never contains frontmatter (it is stripped
   * on seed); the editor re-attaches THIS value on autosave. Keeping it in the doc — rather than
   * locked at open time — is what lets a server-side edit (e.g. copilot) that changes the frontmatter
   * be reflected instead of reverted by an open editor's autosave.
   */
  frontmatterKey: 'frontmatter',
} as const

/**
 * The timeouts for the file-doc conversion round-trips, in ONE place because two of the pairs form an
 * ordering invariant that would otherwise live only in prose comments across two apps. A nested call's
 * bound must exceed the bound of the call it wraps, or the outer aborts while the inner is still
 * running — orphaning work that lands late (see the assertion in the accompanying test):
 *
 * - `applyEditMs` (app → relay `apply-edit`, in `apps/sim`) wraps `mergeRequestMs` (relay → app
 *   `/merge`, in `apps/realtime`), so `mergeRequestMs < applyEditMs`.
 * - `readinessDeadlineMs` (the client's give-up-and-fall-back-read-only deadline) must outlast
 *   `seedRequestMs` (relay → app `/seed`), so `seedRequestMs < readinessDeadlineMs`.
 *
 * The seed request gets more headroom than the merge because it reads a (possibly cold) blob before
 * converting; the merge is a pure in-memory conversion the caller fully supplies.
 */
export const FILE_DOC_TIMEOUTS = {
  seedRequestMs: 8_000,
  mergeRequestMs: 3_000,
  applyEditMs: 6_000,
  readinessDeadlineMs: 12_000,
} as const

/** Client → server join request. `fileId` is the `workspace_files.id`. */
export interface JoinFileDocPayload {
  fileId: string
  /**
   * The joining Yjs document's `clientID`. The server binds it to this socket so
   * a client can only publish/remove awareness (cursor/selection) for its own
   * client — an authenticated peer cannot forge or clear another's presence.
   */
  clientId: number
}

/** Server → client acceptance of a {@link FILE_DOC_EVENTS.JOIN}. */
export interface JoinFileDocSuccess {
  fileId: string
}

/** Server → client rejection of a {@link FILE_DOC_EVENTS.JOIN}. */
export interface JoinFileDocError {
  fileId: string
  error: string
  code: string
  retryable?: boolean
}

/** Client → server leave request. */
export interface LeaveFileDocPayload {
  fileId: string
}

/** One collaborator session in a {@link FileDocPresence} roster — server-authenticated identity.
 * Keyed per socket (session), not per user: the client excludes its OWN `socketId` and then
 * dedupes the rest per user for the avatar stack, so a second tab of the same account still
 * registers as present (mirroring the canvas presence model). */
export interface FileDocPresenceUser {
  /** The collaborator's socket id, so a client can exclude its own session (not every session
   * that happens to share its userId). */
  socketId: string
  userId: string
  userName: string
  avatarUrl: string | null
}

/** Server → client roster of who is in the document ({@link FILE_DOC_EVENTS.PRESENCE}). */
export interface FileDocPresence {
  fileId: string
  users: FileDocPresenceUser[]
}

/**
 * Coerce a Socket.IO binary payload to a `Uint8Array`, or `null` if it is
 * neither. Shared by the server relay and the client provider so the two agree
 * on how an inbound {@link FILE_DOC_EVENTS.MESSAGE} frame is read (Socket.IO may
 * deliver a `Uint8Array`/`Buffer` or an `ArrayBuffer` depending on runtime).
 */
export function toFileDocBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return null
}
