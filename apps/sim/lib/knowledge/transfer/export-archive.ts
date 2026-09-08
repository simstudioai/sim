import { once } from 'node:events'
import { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { ZipArchive } from 'archiver'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import type { KnowledgeBaseExportBundle } from '@/lib/knowledge/application/exports'
import { KNOWLEDGE_BUNDLE_VERSION } from '@/lib/knowledge/constants'
import {
  chunksEntryPath,
  encodeVectorBase64,
  fileEntryPath,
  KNOWLEDGE_BUNDLE_MANIFEST_ENTRY,
  type KnowledgeBundleChunkLine,
  type KnowledgeBundleDocument,
  type KnowledgeBundleManifest,
  safeBundleLeafName,
  toManifestDocument,
} from '@/lib/knowledge/transfer/bundle'
import type { ExportableChunk, ExportableFileSource } from '@/lib/knowledge/transfer/export-source'
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
  return decodeDataUriWithinLimit(source.fileUrl, MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE).buffer
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
 * place, which `once` turns into a rejection.
 */
async function appendEntry(
  archive: ZipArchive,
  source: Readable | Buffer | string,
  name: string
): Promise<void> {
  const consumed = once(archive, 'entry')
  archive.append(source, { name })
  await consumed
}

/** Appends a document's chunks as NDJSON and returns how many lines were written. */
async function appendChunkEntry(
  archive: ZipArchive,
  chunks: AsyncIterable<ExportableChunk>,
  vectors: boolean,
  name: string
): Promise<number> {
  let written = 0
  const lines = Readable.from(
    (async function* () {
      for await (const chunk of chunks) {
        yield `${JSON.stringify(toChunkLine(chunk, vectors))}\n`
        written += 1
      }
    })(),
    { objectMode: false }
  )
  await appendEntry(archive, lines, name)
  return written
}

async function appendBundleEntries(
  archive: ZipArchive,
  bundle: KnowledgeBaseExportBundle
): Promise<void> {
  const documents: KnowledgeBundleDocument[] = []
  for (const document of bundle.documents) {
    let file: string | null = null
    if (document.file) {
      file = fileEntryPath(document.id, document.filename)
      await appendEntry(archive, await openFileSource(document.file), file)
    }
    const chunks = document.hasChunks ? chunksEntryPath(document.id) : null
    const chunkCount = chunks
      ? await appendChunkEntry(
          archive,
          bundle.chunks(document.id),
          bundle.embedding.vectorsIncluded,
          chunks
        )
      : 0
    documents.push(toManifestDocument(document, { file, chunks }, chunkCount))
  }

  const manifest: KnowledgeBundleManifest = {
    version: KNOWLEDGE_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    embedding: bundle.embedding,
    knowledgeBase: bundle.knowledgeBase,
    tags: bundle.tags,
    documents,
  }
  await appendEntry(archive, JSON.stringify(manifest, null, 2), KNOWLEDGE_BUNDLE_MANIFEST_ENTRY)
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
  appendBundleEntries(archive, bundle).catch((error: unknown) => {
    logger.error('Failed to build knowledge base bundle archive', { error })
    archive.destroy(toError(error))
  })
  return archive
}
