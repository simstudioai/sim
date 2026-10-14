import { Buffer, isUtf8 } from 'node:buffer'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { isSupportedFileType } from '@/lib/file-parsers'
import { getFileParserErrorCode } from '@/lib/file-parsers/errors'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { FILE_SEARCH_MAX_EXTRACTED_BYTES } from '@/lib/workspace-files/search/constants'
import { FileSearchExclusionError } from '@/lib/workspace-files/search/index-plan'
import { parseWorkspaceFileText } from '@/lib/workspace-files/text-extraction'

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

function isPlainText(buffer: Buffer): boolean {
  return isUtf8(buffer) && !buffer.includes(0)
}

function boundText(content: string, truncated: boolean): ExtractedIndexText {
  if (Buffer.byteLength(content, 'utf8') > FILE_SEARCH_MAX_EXTRACTED_BYTES) {
    throw new FileSearchExclusionError('extracted_text_too_large')
  }
  return { text: content, partial: truncated }
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
      const parsed = await parseWorkspaceFileText(buffer, extension, {
        signal,
        maxTextBytes: FILE_SEARCH_MAX_EXTRACTED_BYTES,
      })
      if (parsed.metadata?.degraded) return null
      return boundText(parsed.content ?? '', parsed.metadata?.truncated === true)
    } catch (error) {
      signal.throwIfAborted()
      if (isPayloadSizeLimitError(error))
        throw new FileSearchExclusionError('extracted_text_too_large')
      if (error instanceof FileSearchExclusionError) throw error
      if (getFileParserErrorCode(error) === 'complexity_limit')
        throw new FileSearchExclusionError('incomplete_extraction')
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
