import { Readable } from 'node:stream'
import {
  CSV_DELIMITER_SNIFF_BYTES,
  type CsvDelimiter,
  detectCsvDelimiter,
} from '@/lib/table/import'

export interface SniffedCsvStream {
  delimiter: CsvDelimiter
  /**
   * The full file contents, replayed from byte zero. Use this in place of the
   * source stream — the source has already been partially consumed.
   */
  stream: Readable
}

/**
 * Reads the head of a CSV/TSV stream, sniffs its field separator, then returns a
 * stream that replays the buffered head followed by the untouched remainder.
 *
 * Memory is bounded: it buffers only the source chunks needed to reach the
 * {@link CSV_DELIMITER_SNIFF_BYTES} window (one chunk past it, at worst), and the
 * detection sample it copies is capped at exactly that window regardless of how
 * large a single upstream chunk is. Those buffered chunks are then replayed
 * *by reference* — never re-copied — so a multi-GB import stays O(sniff window)
 * plus the single in-flight chunk. {@link detectCsvDelimiter} drops any partial
 * trailing line, so no newline trimming is needed here.
 */
export async function sniffCsvDelimiterFromStream(
  source: Readable,
  fallback: CsvDelimiter = ','
): Promise<SniffedCsvStream> {
  const reader = source[Symbol.asyncIterator]()
  const chunks: Buffer[] = []
  let size = 0
  let exhausted = false

  while (size < CSV_DELIMITER_SNIFF_BYTES) {
    const next = await reader.next()
    if (next.done) {
      exhausted = true
      break
    }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value as Uint8Array)
    chunks.push(chunk)
    size += chunk.length
  }

  // Copy at most the sniff window for detection — `Buffer.concat`'s length arg truncates,
  // so an oversized final chunk can't inflate this allocation past CSV_DELIMITER_SNIFF_BYTES.
  const sample = Buffer.concat(chunks, Math.min(size, CSV_DELIMITER_SNIFF_BYTES))
  const delimiter = await detectCsvDelimiter(sample, fallback)

  const stream = Readable.from(
    (async function* replay() {
      // Replay the already-read chunks by reference (no re-copy), then drain the rest.
      for (const chunk of chunks) yield chunk
      if (exhausted) return
      while (true) {
        const next = await reader.next()
        if (next.done) return
        yield next.value
      }
    })()
  )

  // `Readable.from` closes the generator on destroy, which returns the source
  // iterator — but an early destroy of the wrapper before the generator is
  // pulled would otherwise leak the source's socket.
  stream.on('close', () => source.destroy())

  return { delimiter, stream }
}
