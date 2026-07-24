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
 * Where the client records that it has seeded the document's initial content,
 * stored inside the Yjs document as `doc.getMap(configMap).get(flag) === true`.
 * Because it lives in the CRDT it merges across clients and the server can read
 * it — the server uses it to decide whether to re-elect a seeder when an elected
 * one disconnects before seeding. Client and server MUST use these exact keys.
 */
export const FILE_DOC_SEED = {
  configMap: 'config',
  flag: 'initialContentLoaded',
} as const

/** Client → server join request. `fileId` is the `workspace_files.id`. */
export interface JoinFileDocPayload {
  fileId: string
}

/** Server → client acceptance of a {@link FILE_DOC_EVENTS.JOIN}. */
export interface JoinFileDocSuccess {
  fileId: string
  /**
   * Whether this client was elected to seed the document's initial content from
   * the file's stored markdown. The server elects exactly one client per empty
   * document, so seeding never duplicates even under a cold-start race; the
   * client additionally guards on the CRDT `initialContentLoaded` flag to cover
   * the case where an elected seeder disconnects before it seeds.
   */
  shouldSeed: boolean
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
