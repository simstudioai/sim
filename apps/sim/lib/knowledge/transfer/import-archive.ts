/**
 * Read side of a knowledge-base bundle import. The archive is opened from a
 * local file so each entry is inflated on demand rather than the whole bundle
 * held in memory, and nothing in it is trusted: the manifest is validated
 * against the format, every entry it names must exist within its ceiling, and
 * each chunk line is validated as it is read. yauzl enforces each entry's
 * declared size while inflating, so a forged header cannot expand past the
 * ceiling it was checked against.
 */

import { createInterface } from 'node:readline'
import { type Entry, openPromise, type ZipFile } from 'yauzl'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  MAX_KNOWLEDGE_BUNDLE_CHUNKS_ENTRY_BYTES,
  MAX_KNOWLEDGE_BUNDLE_DOCUMENTS,
  MAX_KNOWLEDGE_BUNDLE_MANIFEST_BYTES,
} from '@/lib/knowledge/constants'
import type { PreparedDocumentIndex } from '@/lib/knowledge/documents/service'
import {
  decodeVectorBase64,
  KNOWLEDGE_BUNDLE_MANIFEST_ENTRY,
  type KnowledgeBundleDocument,
  type KnowledgeBundleManifest,
  knowledgeBundleChunkLineSchema,
  knowledgeBundleManifestSchema,
} from '@/lib/knowledge/transfer/bundle'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'

/** A file and a chunk entry per document, plus the manifest. */
const MAX_BUNDLE_ENTRIES = 2 * MAX_KNOWLEDGE_BUNDLE_DOCUMENTS + 1

export interface KnowledgeBundleReader {
  readonly manifest: KnowledgeBundleManifest
  /** A document's original file, by the entry its manifest names. */
  readFile(entry: string): Promise<Buffer>
  /**
   * A document's chunks in index order, ready to index. With `vectors`, every
   * line must carry a vector of the manifest's dimension; without, none is decoded.
   */
  readChunks(
    document: Pick<KnowledgeBundleDocument, 'chunkCount'> & { chunks: string },
    vectors: boolean
  ): Promise<PreparedDocumentIndex>
  close(): void
}

function bundleError(message: string): OrchestrationError {
  return new OrchestrationError('validation', `Invalid knowledge base bundle: ${message}`)
}

async function indexEntries(zip: ZipFile): Promise<Map<string, Entry>> {
  if (zip.entryCount > MAX_BUNDLE_ENTRIES) {
    throw bundleError(`more than ${MAX_BUNDLE_ENTRIES} entries`)
  }
  const entries = new Map<string, Entry>()
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: Entry) => {
      if (entries.has(entry.fileName)) {
        reject(bundleError(`duplicate entry ${entry.fileName}`))
        return
      }
      entries.set(entry.fileName, entry)
      zip.readEntry()
    })
    zip.once('end', resolve)
    zip.once('error', reject)
    zip.readEntry()
  })
  return entries
}

/** Inflates an entry into a buffer of its declared size, so a large file is held once. */
async function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(entry.uncompressedSize)
  let offset = 0
  for await (const chunk of await zip.openReadStreamPromise(entry)) {
    if (offset + chunk.length > bytes.length) {
      throw bundleError(`entry ${entry.fileName} is larger than it declares`)
    }
    offset += (chunk as Buffer).copy(bytes, offset)
  }
  return bytes
}

function requireEntry(entries: Map<string, Entry>, name: string, maxBytes: number): Entry {
  const entry = entries.get(name)
  if (!entry) throw bundleError(`missing entry ${name}`)
  if (entry.isEncrypted()) throw bundleError(`entry ${name} is encrypted`)
  if (entry.uncompressedSize > maxBytes) {
    throw bundleError(`entry ${name} exceeds ${maxBytes} bytes`)
  }
  return entry
}

function parseManifest(bytes: Buffer): KnowledgeBundleManifest {
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw bundleError('manifest.json is not valid JSON')
  }
  const result = knowledgeBundleManifestSchema.safeParse(raw)
  if (!result.success) {
    const [issue] = result.error.issues
    throw bundleError(`manifest ${issue.path.join('.')} ${issue.message}`)
  }
  const ids = new Set<string>()
  for (const document of result.data.documents) {
    if (ids.has(document.id)) throw bundleError(`duplicate document id ${document.id}`)
    ids.add(document.id)
  }
  return result.data
}

/**
 * Opens a bundle archive and validates its manifest and the entries it names
 * before any document is read, so a malformed bundle is refused before the
 * import writes anything.
 */
export async function openKnowledgeBundle(path: string): Promise<KnowledgeBundleReader> {
  let zip: ZipFile
  try {
    zip = await openPromise(path, { lazyEntries: true, autoClose: false })
  } catch {
    throw bundleError('not a zip archive')
  }
  try {
    const entries = await indexEntries(zip)
    const manifest = parseManifest(
      await readEntry(
        zip,
        requireEntry(entries, KNOWLEDGE_BUNDLE_MANIFEST_ENTRY, MAX_KNOWLEDGE_BUNDLE_MANIFEST_BYTES)
      )
    )
    const validated = new Map<string, Entry>()
    for (const document of manifest.documents) {
      if (document.file) {
        validated.set(
          document.file,
          requireEntry(entries, document.file, MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE)
        )
      }
      if (document.chunks) {
        validated.set(
          document.chunks,
          requireEntry(entries, document.chunks, MAX_KNOWLEDGE_BUNDLE_CHUNKS_ENTRY_BYTES)
        )
      }
    }
    const entryFor = (name: string) => {
      const entry = validated.get(name)
      if (!entry) throw new Error(`Bundle entry ${name} is not named by its manifest`)
      return entry
    }

    return {
      manifest,
      readFile: (name) => readEntry(zip, entryFor(name)),
      async readChunks(document, vectors) {
        const name = document.chunks
        const stream = await zip.openReadStreamPromise(entryFor(name))
        const chunks: PreparedDocumentIndex['chunks'][number][] = []
        const decoded: number[][] = []
        let previousIndex = -1
        for await (const line of createInterface({
          input: stream,
          crlfDelay: Number.POSITIVE_INFINITY,
        })) {
          if (line.length === 0) continue
          let raw: unknown
          try {
            raw = JSON.parse(line)
          } catch {
            throw bundleError(`${name} line ${chunks.length + 1} is not valid JSON`)
          }
          const parsed = knowledgeBundleChunkLineSchema.safeParse(raw)
          if (!parsed.success) {
            const [issue] = parsed.error.issues
            throw bundleError(
              `${name} line ${chunks.length + 1} ${issue.path.join('.')} ${issue.message}`
            )
          }
          const chunk = parsed.data
          if (chunk.index <= previousIndex) throw bundleError(`${name} chunks are out of order`)
          previousIndex = chunk.index
          if (vectors) {
            const vector = chunk.vector
              ? decodeVectorBase64(chunk.vector, manifest.embedding.dimension)
              : null
            if (!vector) throw bundleError(`${name} chunk ${chunk.index} has no valid vector`)
            decoded.push(vector)
          }
          chunks.push({
            text: chunk.content,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            enabled: chunk.enabled,
          })
        }
        if (chunks.length !== document.chunkCount) {
          throw bundleError(
            `${name} holds ${chunks.length} chunks, but the manifest lists ${document.chunkCount}`
          )
        }
        return vectors ? { chunks, vectors: decoded } : { chunks }
      },
      close: () => zip.close(),
    }
  } catch (error) {
    zip.close()
    throw error
  }
}
