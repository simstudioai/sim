import { createLogger } from '@sim/logger'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import * as Y from 'yjs'
import {
  assertCollabDocStateSize,
  type CachedCollabDocState,
  CollabDocStateConflictError,
  commitCollabDocState,
  hashMarkdown,
  loadCollabDocState,
  type PreparedCollabDocState,
} from '@/lib/collab-doc/collab-state'
import { yDocToFileMarkdown } from '@/lib/collab-doc/converter'
import {
  ContentVersionConflictError,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
} from '@/lib/uploads/contexts/workspace'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const logger = createLogger('FileDocPersist')
const MAX_PERSIST_ATTEMPTS = 2

/** Only an accepted content/cache transaction advances the relay's durable content version. */
export type PersistFileDocResult =
  | { status: 'persisted'; version: number }
  | { status: 'missing' }
  | { status: 'conflict' }
  | { status: 'deferred' }

/**
 * Persist the relay's snapshot and its Markdown projection together. Conversion and blob I/O stay
 * outside the file-row transaction; content version and cached-state fences protect its commit.
 * `userId` is attribution only: the internal surface authorizes the caller before this operation.
 */
export async function persistFileDoc(
  workspaceId: string,
  fileId: string,
  userId: string,
  docState: Uint8Array,
  expectedVersion?: number
): Promise<PersistFileDocResult> {
  const initialRecord = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!initialRecord) return { status: 'missing' }
  if (expectedVersion === undefined) return { status: 'deferred' }
  assertCollabDocStateSize(docState)
  const candidate = new Y.Doc()
  let markdown: Buffer
  try {
    Y.applyUpdate(candidate, docState)
    markdown = Buffer.from(yDocToFileMarkdown(candidate), 'utf-8')
  } finally {
    candidate.destroy()
  }

  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt++) {
    const record =
      attempt === 0
        ? initialRecord
        : await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
    if (!record) return { status: 'missing' }
    const version = (record.contentUpdatedAt ?? record.updatedAt).getTime()
    const cached = await loadCollabDocState(fileId)
    let durable: Buffer | null = null
    if (record.size === markdown.length || version !== expectedVersion) {
      durable = await fetchWorkspaceFileBuffer(record, {
        maxBytes: version === expectedVersion ? markdown.length : MAX_BUFFERED_TRANSFER_BYTES,
      })
    }
    const prepared = preparePersistedState(
      docState,
      cached,
      markdown,
      version !== expectedVersion && !durable?.equals(markdown)
    )
    if (!prepared) return { status: 'conflict' }

    try {
      if (durable?.equals(markdown)) {
        const result = await commitCollabDocState(workspaceId, fileId, version, prepared)
        if (result.status === 'committed') {
          return { status: 'persisted', version: result.version }
        }
        if (result.status === 'missing') return result
        continue
      }

      /** A stale relay token may advance only if the cached history accounts for the durable bytes. */
      if (
        version !== expectedVersion &&
        (!durable || cached?.sourceHash !== hashMarkdown(durable))
      ) {
        return { status: 'conflict' }
      }

      const updated = await updateWorkspaceFileContent(
        workspaceId,
        fileId,
        userId,
        markdown,
        undefined,
        {
          syncLiveDoc: false,
          expectedUpdatedAt: new Date(version),
          secretProvenancePolicy: { mode: 'preserve' },
          collabDocState: prepared,
        }
      )
      logger.info(`Persisted collaborative document for file ${fileId}`)
      return {
        status: 'persisted',
        version: (updated.contentUpdatedAt ?? updated.updatedAt).getTime(),
      }
    } catch (error) {
      if (
        !(error instanceof ContentVersionConflictError) &&
        !(error instanceof CollabDocStateConflictError)
      ) {
        throw error
      }
    }
  }

  logger.warn(`Persist conflict for file ${fileId}; the file or cached history changed during save`)
  return { status: 'conflict' }
}

/**
 * The relay owns the full snapshot. Legacy caches can contain detached normalization deletions
 * never sent to that relay, so they cannot be merged into saved state. For stale content writes,
 * use a throwaway merge only to prove the candidate does not omit durable content.
 */
function preparePersistedState(
  docState: Uint8Array,
  cached: CachedCollabDocState | null,
  markdown: Buffer,
  proveContentIncluded: boolean
): PreparedCollabDocState | null {
  if (!cached) return { docState, sourceHash: hashMarkdown(markdown), expectedState: null }
  const candidate = new Y.Doc()
  const persisted = new Y.Doc()
  try {
    Y.applyUpdate(candidate, docState)
    Y.applyUpdate(persisted, cached.docState)
    const generation = (doc: Y.Doc) =>
      doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
    if (generation(candidate) !== generation(persisted)) return null
    if (proveContentIncluded) {
      Y.applyUpdate(candidate, cached.docState)
      if (!Buffer.from(yDocToFileMarkdown(candidate), 'utf-8').equals(markdown)) return null
    }
    return {
      docState,
      sourceHash: hashMarkdown(markdown),
      expectedState: { stateHash: cached.stateHash, sourceHash: cached.sourceHash },
    }
  } finally {
    candidate.destroy()
    persisted.destroy()
  }
}
