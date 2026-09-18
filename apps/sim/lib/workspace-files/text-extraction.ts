import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { parseBuffer } from '@/lib/file-parsers'

/** Search and content reads must share the same text representation and logical line numbers. */
export async function parseWorkspaceFileText(
  buffer: Buffer,
  extension: string,
  options: { maxTextBytes: number; signal?: AbortSignal }
) {
  options.signal?.throwIfAborted()
  const result = await parseBuffer(buffer, extension, {
    contentMode: 'complete',
    pdfTextMode: 'complete',
    maxTextBytes: options.maxTextBytes,
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  assertKnownSizeWithinLimit(
    Buffer.byteLength(result.content ?? '', 'utf8'),
    options.maxTextBytes,
    'extracted file text'
  )
  return result
}
