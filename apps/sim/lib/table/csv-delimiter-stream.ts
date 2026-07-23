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
 * Only {@link CSV_DELIMITER_SNIFF_BYTES} are ever held in memory, so this stays
 * safe on multi-GB imports. The buffered head is trimmed to its last newline
 * before sniffing so a mid-record cut can't skew the column counts.
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

  const head = Buffer.concat(chunks)
  let sample = head
  if (!exhausted) {
    const lastNewline = head.lastIndexOf(0x0a)
    if (lastNewline > 0) sample = head.subarray(0, lastNewline + 1)
  }

  const delimiter = await detectCsvDelimiter(sample, fallback)

  const stream = Readable.from(
    (async function* replay() {
      if (head.length > 0) yield head
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
