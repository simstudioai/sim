import { once } from 'node:events'
import { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { ZipArchive } from 'archiver'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import type { KnowledgeBaseExportBundle } from '@/lib/knowledge/application/exports'
import { KNOWLEDGE_BUNDLE_VERSION } from '@/lib/knowledge/constants'
import { MAX_DOCUMENT_CHUNKS } from '@/lib/knowledge/documents/document-processing-error'
import {
  bundleEntryPaths,
  encodeVectorBase64,
  KNOWLEDGE_BUNDLE_MANIFEST_ENTRY,
  type KnowledgeBundleChunkLine,
  type KnowledgeBundleDocument,
  parseDescribableBundle,
  safeBundleLeafName,
  toManifestDocument,
} from '@/lib/knowledge/transfer/bundle'
import {
  type ExportableChunk,
  type ExportableFileSource,
  readInlineFileUrl,
} from '@/lib/knowledge/transfer/export-source'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'

const logger = createLogger('KnowledgeExportArchive')

/** Chunk text compresses several times over; vectors do not, so a middle level pays off either way. */
const ZIP_COMPRESSION_LEVEL = 6

/** The download name for a knowledge base's bundle. */
export function knowledgeBundleFileName(knowledgeBaseName: string): string {
  return `${safeBundleLeafName(knowledgeBaseName)}.simkb.zip`
}

async function openFileSource(source: ExportableFileSource): Promise<Readable | Buffer> {
  if (source.kind === 'storage') {
    return downloadFileStream({ key: source.key, context: 'knowledge-base' })
  }
  return decodeDataUriWithinLimit(
    await readInlineFileUrl(source.knowledgeBaseId, source.documentId),
    MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE
  ).buffer
}

/**
 * Projects a chunk onto its NDJSON line. `vectors` is the manifest's promise:
 * a vector the source still carries is dropped when the manifest says none are
 * included, so the lines never contradict `embedding.vectorsIncluded`.
 */
function toChunkLine(chunk: ExportableChunk, vectors: boolean): KnowledgeBundleChunkLine {
  const { vector, ...line } = chunk
  return vectors && vector ? { ...line, vector: encodeVectorBase64(vector) } : line
}

/**
 * Appends one entry and resolves once the archiver has consumed it.
 *
 * The archiver pipes a source into its own buffer the moment it is appended,
 * so appending everything up front would open every blob at once and read the
 * manifest before any chunk stream ended. Waiting on the archiver's `entry`
 * event keeps exactly one source open and lets the manifest go last with the
 * counts the chunk streams actually produced. Archiver drains its queue one
 * entry at a time and emits `entry` exactly once per append, or `error` in its
 * place, which `once` turns into a rejection. A consumer that goes away
 * destroys the archive without either event, so `closed` aborts the wait and
 * the in-flight source is released instead of leaking; an append is refused
 * outright once it has fired, since a destroyed archive has no listener left
 * to receive the error it would emit.
 */
async function appendEntry(
  archive: ZipArchive,
  source: Readable | Buffer | string,
  name: string,
  closed: AbortSignal
): Promise<void> {
  if (closed.aborted) {
    if (source instanceof Readable) source.destroy()
    closed.throwIfAborted()
  }
  const consumed = once(archive, 'entry', { signal: closed })
  archive.append(source, { name })
  try {
    await consumed
  } catch (error) {
    if (source instanceof Readable) source.destroy()
    throw error
  }
}

/**
 * Appends a document's chunks as NDJSON and returns how many lines were written.
 *
 * The stream is bounded by the same per-document ceiling the bundle format
 * declares: `document.chunkCount` is denormalized, so a document re-chunked
 * while the export runs can hold more rows than its counter claimed and the
 * pre-flight gate approved. The stream stops at the ceiling and the failure is
 * raised afterwards rather than thrown into the generator, because a source
 * that rejects mid-pipe surfaces as an unhandled stream error instead of
 * reaching the caller.
 */
async function appendChunkEntry(
  archive: ZipArchive,
  chunks: AsyncIterable<ExportableChunk>,
  vectors: boolean,
  name: string,
  closed: AbortSignal
): Promise<number> {
  let written = 0
  let exceeded = false
  const lines = Readable.from(
    (async function* () {
      for await (const chunk of chunks) {
        if (written >= MAX_DOCUMENT_CHUNKS) {
          exceeded = true
          return
        }
        yield `${JSON.stringify(toChunkLine(chunk, vectors))}\n`
        written += 1
      }
    })(),
    { objectMode: false }
  )
  await appendEntry(archive, lines, name, closed)
  if (exceeded) {
    throw new OrchestrationError(
      'conflict',
      `A document holds more than ${MAX_DOCUMENT_CHUNKS} chunks, the most a bundle describes`
    )
  }
  return written
}

async function appendBundleEntries(
  archive: ZipArchive,
  bundle: KnowledgeBaseExportBundle,
  closed: AbortSignal
): Promise<void> {
  const documents: KnowledgeBundleDocument[] = []
  for (const document of bundle.documents) {
    const entries = bundleEntryPaths(document)
    if (document.file && entries.file) {
      await appendEntry(archive, await openFileSource(document.file), entries.file, closed)
    }
    const chunkCount = entries.chunks
      ? await appendChunkEntry(
          archive,
          bundle.chunks(document.id),
          bundle.embedding.vectorsIncluded,
          entries.chunks,
          closed
        )
      : 0
    documents.push(toManifestDocument(document, entries, chunkCount))
  }

  /**
   * The written manifest, not a manifest shaped like it: the counts here come
   * from what each chunk stream produced, so this is the only validation that
   * covers the artifact a reader receives. A throw destroys the archive, and a
   * truncated download is detectable where an invalid manifest is not.
   */
  const manifest = parseDescribableBundle({
    version: KNOWLEDGE_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    embedding: bundle.embedding,
    knowledgeBase: bundle.knowledgeBase,
    tags: bundle.tags,
    documents,
  })
  await appendEntry(
    archive,
    JSON.stringify(manifest, null, 2),
    KNOWLEDGE_BUNDLE_MANIFEST_ENTRY,
    closed
  )
  await archive.finalize()
}

/**
 * Streams a knowledge base as its bundle archive.
 *
 * Entries are appended one at a time in document order, so peak memory is one
 * blob stream or one page of chunks. The manifest goes last: every document's
 * chunk count is whatever its chunk stream actually wrote, so a document edited
 * while the export ran still describes itself truthfully.
 */
export function buildKnowledgeBundleArchive(bundle: KnowledgeBaseExportBundle): Readable {
  const archive = new ZipArchive({ zlib: { level: ZIP_COMPRESSION_LEVEL } })
  archive.on('warning', (error: Error) => {
    logger.warn('Archive warning while streaming knowledge base bundle', { error })
  })
  const closed = new AbortController()
  archive.once('close', () => closed.abort())
  appendBundleEntries(archive, bundle, closed.signal).catch((error: unknown) => {
    /**
     * Archiver emits `close` when it fails as well as when the consumer walks
     * away, so the signal alone cannot tell the two apart. Only the abort's own
     * error means nobody is listening; anything else is a failure the consumer
     * must still see, and swallowing it would hand them a silently truncated archive.
     */
    if (toError(error).name === 'AbortError') return
    logger.error('Failed to build knowledge base bundle archive', { error })
    archive.destroy(toError(error))
  })
  return archive
}
