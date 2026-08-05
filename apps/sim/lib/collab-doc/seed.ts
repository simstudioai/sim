import { createLogger } from '@sim/logger'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import * as Y from 'yjs'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'
import { hashMarkdown, loadFreshCollabDocState } from './collab-state'
import { markdownToYDoc } from './converter'
import { stripEmptyTopLevelParagraphs } from './normalize'

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
 * Repair a cached Yjs snapshot before it seeds a room: strip any top-level empty paragraphs the markdown
 * re-parse would drop (see {@link stripEmptyTopLevelParagraphs}), so a warm seed renders identically to
 * the static placeholder and never surfaces a stray blank line once the doc settles. Returns the original
 * bytes untouched when the snapshot is already clean (the common case) — no re-encode cost — and a fresh
 * encode (preserving the CRDT's client ids, only adding tombstones for the removed empties) when it
 * repaired a legacy snapshot baked before this normalization existed.
 */
function normalizeSeedUpdate(cached: Uint8Array): Uint8Array {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, cached)
    return stripEmptyTopLevelParagraphs(doc) ? Y.encodeStateAsUpdate(doc) : cached
  } finally {
    doc.destroy()
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

  // Cold-start fast path: if we hold a cached Yjs binary derived from THIS exact markdown, apply it
  // directly (the Hocuspocus load-document pattern) instead of re-converting. This preserves the CRDT's
  // client ids across reopens — no duplicated content, no split-brain — and skips the server-side
  // headless conversion. A stale/absent cache (markdown edited externally, or first ever open) falls
  // through to the conversion below, and the next persist refreshes the cache.
  //
  // Best-effort read: the cache is an optimization over the durable markdown we already hold, so a
  // transient DB error (or a not-yet-migrated cache table) must fall through to conversion rather than
  // block the cold open — symmetric with persist's best-effort cache write.
  try {
    const cached = await loadFreshCollabDocState(fileId, hashMarkdown(buffer))
    if (cached) return { update: normalizeSeedUpdate(cached), version }
  } catch (error) {
    logger.warn(`Failed to read cached collab doc state for file ${fileId}`, {
      error: getErrorMessage(error),
    })
  }

  const markdown = buffer.toString('utf-8')
  const { frontmatter, body } = splitFrontmatter(markdown)

  const ydoc = markdownToYDoc(body)
  try {
    const config = ydoc.getMap(FILE_DOC_SEED.configMap)
    // Mark the document seeded IN the same doc, so the client's readiness gate
    // (`synced && initialContentLoaded === true`) recognizes a server-seeded doc without any
    // client-seeder handshake, and a stray re-election can never seed on top of it.
    config.set(FILE_DOC_SEED.flag, true)
    // Carry the frontmatter in the doc (not the body) so it merges across clients and a later
    // server-side edit can update it — the editor re-attaches this on autosave.
    config.set(FILE_DOC_SEED.frontmatterKey, frontmatter)
    return { update: Y.encodeStateAsUpdate(ydoc), version }
  } finally {
    ydoc.destroy()
  }
}
