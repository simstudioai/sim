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
  /**
   * Server → client: this client is elected to seed the document's initial
   * content from the file's stored markdown ({@link SeedRequestPayload}). Sent to
   * exactly one client of an unseeded document — at join, or later to a remaining
   * client if the previously-elected seeder disconnects before it seeds.
   */
  SEED_REQUEST: 'file-doc-seed-request',
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
 *
 * The seeding client MUST write the imported content AND set this flag in a
 * SINGLE Yjs transaction (`doc.transact(...)`). Otherwise a seeder that dies
 * between the two writes can leave content with no flag, and a re-elected client
 * would seed again and duplicate it. `configMap` is a reserved top-level Y.Map
 * name; the editor must not use a top-level type of the same name (TipTap uses
 * `getXmlFragment('default')`, so there is no collision today).
 */
export const FILE_DOC_SEED = {
  configMap: 'config',
  flag: 'initialContentLoaded',
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

/**
 * Server → client seed election ({@link FILE_DOC_EVENTS.SEED_REQUEST}). The
 * recipient imports the file's stored markdown into the (empty) document. The
 * client still guards on the CRDT `initialContentLoaded` flag so a re-election
 * that races an in-flight seed can never duplicate content.
 *
 * Consumer (editor hook) contract — the relay depends on these to be safe:
 * 1. **Never overwrite content with an unseeded doc.** Autosave (the markdown
 *    mirror written through the content API) MUST be gated on the document being
 *    both synced AND seeded (`initialContentLoaded === true`). Otherwise an empty
 *    or still-syncing doc could be saved over the real file — the one true
 *    data-loss path, and the reason a withholding seeder is only a liveness
 *    nuisance rather than destructive.
 * 2. **Seed atomically, or leave.** Write content + the flag in ONE
 *    `doc.transact(...)`; if seeding fails, emit {@link FILE_DOC_EVENTS.LEAVE}
 *    (or destroy the provider) so the server re-elects another client.
 * 3. **One provider per socket.** Destroy the previous {@link FILE_DOC_EVENTS}
 *    provider before creating the next (document switch), so a stale provider's
 *    binary-frame listener can't apply another document's updates.
 * 4. **Re-mint on CLIENT_ID_IN_USE.** On a `CLIENT_ID_IN_USE` join error,
 *    recreate the Yjs doc (fresh `clientID`) and rejoin rather than giving up —
 *    the id is transiently held by another socket of the same user.
 */
export interface SeedRequestPayload {
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
