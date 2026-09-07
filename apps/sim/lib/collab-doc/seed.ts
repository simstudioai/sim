import { createLogger } from '@sim/logger'
import { FILE_DOC_SEED, FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import * as Y from 'yjs'
import {
  assertCollabDocStateSize,
  CollabDocStateConflictError,
  commitCollabDocState,
  hashMarkdown,
  loadCollabDocState,
} from '@/lib/collab-doc/collab-state'
import { applyMarkdownToYDoc, markdownToYDoc } from '@/lib/collab-doc/converter'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { splitFrontmatter } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/markdown-fidelity'

const logger = createLogger('FileDocSeed')

/**
 * The largest file we will build a collaborative seed for. Beyond this the editor uses its
 * non-collaborative path anyway; converting a huge document server-side would be wasted work.
 */
const MAX_SEED_BYTES = 5 * 1024 * 1024
const MAX_SEED_ATTEMPTS = 3

/** A collaborative document's initial state, encoded as a Yjs update the relay can apply. */
export interface FileDocSeed {
  /** `Y.encodeStateAsUpdate` of the seeded document — apply with `Y.applyUpdate`. */
  update: Uint8Array
  /** Durable content version (epoch ms), used by the relay's next persist. */
  version: number
}

/**
 * Name legacy documents without rewriting their shared tree. Named snapshots retain their original
 * bytes. Even unchanged bytes are fenced before returning, so a concurrent seed/reset cannot
 * publish an unaccepted identity.
 */
function prepareCachedSeed(cached: Uint8Array): Uint8Array {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, cached)
    const named = ensureDocumentIdentity(doc)
    return named ? Y.encodeStateAsUpdate(doc) : cached
  } finally {
    doc.destroy()
  }
}

/**
 * Preserve identities known by reconnecting clients; only unnamed legacy documents need one.
 */
function ensureDocumentIdentity(ydoc: Y.Doc): boolean {
  const config = ydoc.getMap(FILE_DOC_SEED.configMap)
  if (typeof config.get(FILE_DOC_SEED.docIdKey) === 'string') return false
  config.set(FILE_DOC_SEED.docIdKey, generateId())
  return true
}

/**
 * Return only a seed accepted against both the durable file version and the cached Yjs history.
 * Fresh caches retain their tree; external Markdown changes reconcile into the existing history.
 * Returns null only for an absent file. Read/write failures throw so the relay retries rather than
 * treating an unavailable cache as permission to mint a replacement document.
 */
export async function buildFileDocSeed(
  workspaceId: string,
  fileId: string,
  signal?: AbortSignal
): Promise<FileDocSeed | null> {
  const timeoutSignal = AbortSignal.timeout(FILE_DOC_TIMEOUTS.seedRequestMs)
  const seedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt++) {
    seedSignal.throwIfAborted()
    const record = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    seedSignal.throwIfAborted()
    if (!record) return null
    const version = (record.contentUpdatedAt ?? record.updatedAt).getTime()
    const buffer = await fetchWorkspaceFileBuffer(record, {
      maxBytes: MAX_SEED_BYTES,
      signal: seedSignal,
    })
    seedSignal.throwIfAborted()
    const sourceHash = hashMarkdown(buffer)

    /** An unavailable cache is not an absent document: retry without minting a new history. */
    const stored = await loadCollabDocState(fileId)
    seedSignal.throwIfAborted()
    let update: Uint8Array
    if (stored?.sourceHash === sourceHash) {
      update = prepareCachedSeed(stored.docState)
    } else {
      const { frontmatter, body } = splitFrontmatter(buffer.toString('utf-8'))
      const ydoc = resumeDocument(fileId, stored?.docState, body)
      try {
        const config = ydoc.getMap(FILE_DOC_SEED.configMap)
        config.set(FILE_DOC_SEED.flag, true)
        config.set(FILE_DOC_SEED.frontmatterKey, frontmatter)
        ensureDocumentIdentity(ydoc)
        update = Y.encodeStateAsUpdate(ydoc)
      } finally {
        ydoc.destroy()
      }
    }
    assertCollabDocStateSize(update)
    seedSignal.throwIfAborted()

    const result = await commitCollabDocState(workspaceId, fileId, version, {
      docState: update,
      sourceHash,
      expectedState: stored ? { stateHash: stored.stateHash, sourceHash: stored.sourceHash } : null,
    })
    seedSignal.throwIfAborted()
    if (result.status === 'committed') return { update, version: result.version }
    if (result.status === 'missing') return null
  }
  throw new CollabDocStateConflictError(fileId)
}

/**
 * Reconcile external content into the existing history. Recreating equivalent Markdown in a new
 * Y.Doc would assign unrelated item identities and duplicate content when old clients reconnect.
 */
function resumeDocument(fileId: string, stored: Uint8Array | undefined, body: string): Y.Doc {
  if (!stored) return markdownToYDoc(body)
  const ydoc = new Y.Doc()
  try {
    Y.applyUpdate(ydoc, stored)
    applyMarkdownToYDoc(ydoc, body)
    return ydoc
  } catch (error) {
    /** A corrupt binary needs a new identity; the caller must win its cache fence before returning it. */
    logger.warn(`Stored collaborative document for file ${fileId} is unusable; rebuilding it`, {
      error: getErrorMessage(error),
    })
    ydoc.destroy()
    return markdownToYDoc(body)
  }
}
