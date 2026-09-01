import { createLogger } from '@sim/logger'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import * as Y from 'yjs'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import {
  type CachedCollabDocState,
  hashMarkdown,
  loadCollabDocState,
  saveCollabDocState,
} from './collab-state'
import { applyMarkdownToYDoc, canonicalizeYDoc, markdownToYDoc } from './converter'

const logger = createLogger('FileDocSeed')

/**
 * The largest file we will build a collaborative seed for. Beyond this the editor uses its
 * non-collaborative path anyway; converting a huge document server-side would be wasted work.
 */
const MAX_SEED_BYTES = 5 * 1024 * 1024

/** A collaborative document's initial state, encoded as a Yjs update the relay can apply. */
export interface FileDocSeed {
  /** `Y.encodeStateAsUpdate` of the seeded document — apply with `Y.applyUpdate`. */
  update: Uint8Array
  /**
   * The file's durable `updatedAt` (epoch ms) this seed was built from — the version the relay records
   * as what its freshly-seeded live doc is synced to, for the persist optimistic-concurrency guard.
   */
  version: number
}

/**
 * Bring a cached Yjs snapshot into canonical form before it seeds a room, so a warm open and a cold open
 * render the same document as the static placeholder (see {@link canonicalizeYDoc}).
 *
 * The freshness tag is a hash of the markdown alone, carrying no parser version — so a snapshot written
 * under older parse rules still reads as fresh and would otherwise be replayed verbatim, with no path
 * that ever repairs it. Running the round-trip here is that repair, and it doubles as the bound on this
 * branch: the cached path never calls `parseMarkdownToDoc`, so it is the one way into a room that the
 * parse-side limits do not cover. Returns the original bytes untouched when the snapshot is already
 * canonical AND already named (the common case) — no re-encode — and a fresh encode, preserving the
 * CRDT's client ids, when it had to repair or name one.
 *
 * Naming happens here too, not only where a document is built: a document stored before identities
 * existed is returned by this path on every open, so if it were skipped here those files would never
 * acquire one and the join-ack guard could never fire for them — which is the population most likely to
 * have a tab that outlived its room. `changed` tells the caller to store what it got back, so the
 * identity is minted ONCE and every later open agrees with it (a re-minted one would make the guard
 * refuse a client holding the very same document).
 */
function prepareCachedSeed(cached: Uint8Array): { update: Uint8Array; changed: boolean } {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, cached)
    const repaired = canonicalizeYDoc(doc)
    const named = ensureDocumentIdentity(doc)
    return repaired || named
      ? { update: Y.encodeStateAsUpdate(doc), changed: true }
      : { update: cached, changed: false }
  } finally {
    doc.destroy()
  }
}

/**
 * Give a document an identity if it has none, and report whether it needed one. A resumed document
 * keeps the identity its clients already know it by — re-minting would make the join-ack guard refuse
 * a client that holds this exact document.
 */
function ensureDocumentIdentity(ydoc: Y.Doc): boolean {
  const config = ydoc.getMap(FILE_DOC_SEED.configMap)
  if (typeof config.get(FILE_DOC_SEED.docIdKey) === 'string') return false
  config.set(FILE_DOC_SEED.docIdKey, generateId())
  return true
}

/** Store the file's collaborative document. Best-effort: the durable markdown is the source of truth. */
async function storeDocument(
  fileId: string,
  update: Uint8Array,
  sourceHash: string
): Promise<void> {
  try {
    await saveCollabDocState(fileId, update, sourceHash)
  } catch (error) {
    logger.warn(`Failed to store the collaborative document for file ${fileId}`, {
      error: getErrorMessage(error),
    })
  }
}

/**
 * Build the server-side seed for a file's collaborative document: load the file's current markdown
 * and convert it — through the exact client engine (see {@link markdownToYDoc}) — into a Yjs update.
 *
 * This is what makes seeding server-authoritative: the realtime relay applies this to a fresh room's
 * document instead of electing a client to import the content, so the whole client-seeder subsystem
 * (election / deadlines / retries) goes away. The frontmatter is stripped exactly as the client's
 * seed did — it is file metadata, not part of the collaborative body.
 *
 * Returns `null` ONLY when the file is genuinely absent (deleted/never-existed). A transient read
 * failure THROWS (`throwOnError`) rather than returning `null`, so the relay retries instead of
 * mistaking a DB blip for an empty file and seeding blank content over the real document.
 */
export async function buildFileDocSeed(
  workspaceId: string,
  fileId: string
): Promise<FileDocSeed | null> {
  const record = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!record) return null

  // The content-scoped version (advances only on content writes, never on rename/move) is the persist
  // If-Match token — so a metadata bump can't make a racing persist reconcile stale content and clobber
  // live edits. `getWorkspaceFile` always maps it from the NOT NULL column; coalesce is a type guard only.
  const version = (record.contentUpdatedAt ?? record.updatedAt).getTime()
  const buffer = await fetchWorkspaceFileBuffer(record, { maxBytes: MAX_SEED_BYTES })

  const sourceHash = hashMarkdown(buffer)

  // Best-effort read: the cache is an optimization over the durable markdown we already hold, so a
  // transient DB error (or a not-yet-migrated cache table) must fall through to conversion rather than
  // block the cold open — symmetric with the best-effort write below.
  let stored: CachedCollabDocState | null = null
  try {
    stored = await loadCollabDocState(fileId)
  } catch (error) {
    logger.warn(`Failed to read cached collab doc state for file ${fileId}`, {
      error: getErrorMessage(error),
    })
  }

  // Cold-start fast path: the stored document already projects to THIS markdown, so apply it verbatim
  // (the Hocuspocus load-document pattern) instead of re-converting.
  if (stored?.sourceHash === sourceHash) {
    const prepared = prepareCachedSeed(stored.docState)
    // Store a repair or a freshly-minted identity so the next open finds it done — and, for the
    // identity, so every open names the SAME document.
    if (prepared.changed) await storeDocument(fileId, prepared.update, sourceHash)
    return { update: prepared.update, version }
  }

  const { frontmatter, body } = splitFrontmatter(buffer.toString('utf-8'))
  // The markdown moved on out-of-band (a copilot write, the content API, a file tool) — bring the
  // STORED document up to it rather than building a second one. See {@link resumeDocument}.
  const ydoc = resumeDocument(fileId, stored?.docState, body)
  try {
    const config = ydoc.getMap(FILE_DOC_SEED.configMap)
    // Mark the document seeded IN the same doc, so the client's readiness gate
    // (`synced && initialContentLoaded === true`) recognizes a server-seeded doc without any
    // client-seeder handshake, and a stray re-election can never seed on top of it.
    config.set(FILE_DOC_SEED.flag, true)
    // Carry the frontmatter in the doc (not the body) so it merges across clients and a later
    // server-side edit can update it — the editor re-attaches this on autosave.
    config.set(FILE_DOC_SEED.frontmatterKey, frontmatter)
    ensureDocumentIdentity(ydoc)
    const update = Y.encodeStateAsUpdate(ydoc)
    // Store it NOW, not at the next persist. Until this row exists every cold open builds the document
    // again from markdown, minting a new identity each time — so a file that is opened but never edited
    // has a different document on every open, and any client that outlives a room (a laptop that slept
    // past the shared stream's TTL) reconnects into one and merges its content in twice.
    await storeDocument(fileId, update, sourceHash)
    return { update, version }
  } finally {
    ydoc.destroy()
  }
}

/**
 * The file's collaborative document, brought up to `body`.
 *
 * Two Yjs documents built from the same markdown are NOT the same document: their items carry
 * different client ids, so merging them appends one to the other — the file, twice. Anything that
 * rebuilds a document from markdown therefore mints a new identity, and any client still holding the
 * previous one corrupts the file the moment it reconnects. So a document is built exactly once and
 * every later change is applied INTO it as a CRDT diff (the same path a copilot edit takes), which is
 * what keeps one file to one document for its whole life.
 */
function resumeDocument(fileId: string, stored: Uint8Array | undefined, body: string): Y.Doc {
  if (!stored) return markdownToYDoc(body)
  const ydoc = new Y.Doc()
  try {
    Y.applyUpdate(ydoc, stored)
    applyMarkdownToYDoc(ydoc, body)
    return ydoc
  } catch (error) {
    // The stored document is the file's identity, but it is still a CACHE: an undecodable one must not
    // take the file's markdown down with it. Build a new document — which mints a new identity, so a
    // client still holding the old one is refused rather than merged (see FILE_DOC_SEED.docIdKey).
    logger.warn(`Stored collaborative document for file ${fileId} is unusable; rebuilding it`, {
      error: getErrorMessage(error),
    })
    ydoc.destroy()
    return markdownToYDoc(body)
  }
}
