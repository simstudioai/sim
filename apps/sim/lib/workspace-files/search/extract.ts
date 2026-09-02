import { type Buffer, isUtf8 } from 'node:buffer'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { resolveServableDoc } from '@/lib/copilot/tools/server/files/doc-compile'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { isSupportedFileType, parseBuffer } from '@/lib/file-parsers'
import {
  fetchWorkspaceFileBuffer,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  FILE_SEARCH_MAX_EXTRACTED_BYTES,
  FILE_SEARCH_MAX_SOURCE_BYTES,
} from '@/lib/workspace-files/search/constants'
import { truncateUtf8ToBytes } from '@/lib/workspace-files/search/text'

const logger = createLogger('WorkspaceFileSearchExtract')

/**
 * What the index reads for one file revision.
 *
 * - `stored`: the bytes as uploaded, structured formats included.
 * - `artifact`: the compiled document of a generated doc, read from the artifact store.
 * - `source`: a generated doc whose artifact does not exist. The bytes are its generation
 *   source, which is text and must never be handed to the office parsers or executed.
 */
export interface IndexableBytes {
  buffer: Buffer
  kind: 'stored' | 'artifact' | 'source'
}

export interface ExtractedIndexText {
  text: string
  partial: boolean
}

/**
 * Loads the bytes to index without executing anything.
 *
 * Generated documents store their generation source as the primary file and keep the rendered
 * binary in the compiled-artifact store. This reads the artifact when it exists and otherwise
 * settles for the source text, the same read-only resolution the public share route uses.
 * Compile-on-read belongs to download surfaces acting for a principal: an indexer running as
 * nobody inside a worker must not run a document's source, whatever compiler that worker has.
 */
export async function loadIndexableBytes(
  file: WorkspaceFileRecord,
  signal: AbortSignal
): Promise<IndexableBytes> {
  const raw = await fetchWorkspaceFileBuffer(file, {
    maxBytes: FILE_SEARCH_MAX_SOURCE_BYTES,
    signal,
  })
  signal.throwIfAborted()
  const servable = await resolveServableDoc(file.workspaceId, raw, file.name)
  if (servable.kind === 'artifact') {
    assertKnownSizeWithinLimit(
      servable.buffer.length,
      FILE_SEARCH_MAX_SOURCE_BYTES,
      'search index artifact'
    )
    return { buffer: servable.buffer, kind: 'artifact' }
  }
  return { buffer: raw, kind: servable.kind === 'unavailable' ? 'source' : 'stored' }
}

function isPlainText(buffer: Buffer): boolean {
  return isUtf8(buffer) && !buffer.includes(0)
}

function boundText(content: string, truncated: boolean): ExtractedIndexText {
  const bounded = truncateUtf8ToBytes(content, FILE_SEARCH_MAX_EXTRACTED_BYTES)
  return { text: bounded, partial: truncated || bounded.length < content.length }
}

/**
 * Turns bytes into the text to index, or `null` when there is no text to index.
 *
 * Structured formats go through the shared parser registry, exactly as the knowledge base and
 * the file tool read them, so a spreadsheet or a PDF indexes as its text. The registry answers
 * bytes it cannot parse with an exception, and for search that is too strict: a `.json` file a
 * model wrapped in a code fence is still text worth finding. A parser failure on UTF-8 bytes
 * therefore falls back to the raw text, the policy the file tool already applies, while a
 * failure on binary bytes means there is nothing to index. Size-limit breaches and aborts
 * propagate so the caller records them as what they are.
 */
export async function extractIndexText(
  bytes: IndexableBytes,
  fileName: string,
  signal: AbortSignal
): Promise<ExtractedIndexText | null> {
  const { buffer } = bytes
  if (buffer.length === 0) return { text: '', partial: false }
  const extension = getFileExtension(fileName)
  if (bytes.kind !== 'source' && extension && isSupportedFileType(extension)) {
    try {
      const parsed = await parseBuffer(buffer, extension, { signal })
      if (parsed.metadata?.degraded) return null
      return boundText(parsed.content ?? '', parsed.metadata?.truncated === true)
    } catch (error) {
      signal.throwIfAborted()
      if (isPayloadSizeLimitError(error)) throw error
      const plainText = isPlainText(buffer)
      logger.warn(
        plainText
          ? 'Parser rejected a text workspace file; indexing its raw text'
          : 'Parser rejected a binary workspace file; nothing to index',
        { extension, kind: bytes.kind, errorType: toError(error).name }
      )
      if (!plainText) return null
    }
  }
  if (!isPlainText(buffer)) return null
  return boundText(buffer.toString('utf8'), false)
}
