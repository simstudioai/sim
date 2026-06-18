import { Readable } from 'node:stream'
import { truncate } from '@sim/utils/string'
import { parse as parseCsvStream } from 'csv-parse'
import { CSV_PREVIEW_MAX_ROWS } from '@/lib/api/contracts/workspace-file-table'
import type { StorageContext } from '@/lib/uploads/config'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'

/** Cap a single cell so one pathological field can't bloat the preview payload. */
const MAX_CELL_LENGTH = 2_000

/** Read at most this many bytes while sniffing the first line for the delimiter. */
const DELIMITER_SNIFF_MAX_BYTES = 256 * 1024

interface CsvPreviewSliceArgs {
  key: string
  context: StorageContext
  signal?: AbortSignal
}

export interface CsvPreviewSlice {
  headers: string[]
  rows: string[][]
  /** True when the file has more than {@link CSV_PREVIEW_MAX_ROWS} data rows. */
  truncated: boolean
}

/**
 * Detects the CSV delimiter from a header line by frequency. Mirrors the file viewer's
 * client-side heuristic (comma / tab / semicolon) so server-streamed previews match.
 */
function detectDelimiter(line: string): string {
  const commaCount = (line.match(/,/g) || []).length
  const tabCount = (line.match(/\t/g) || []).length
  const semiCount = (line.match(/;/g) || []).length
  if (tabCount > commaCount && tabCount > semiCount) return '\t'
  if (semiCount > commaCount) return ';'
  return ','
}

function cell(value: unknown): string {
  return truncate(String(value ?? ''), MAX_CELL_LENGTH)
}

/**
 * Streams the first {@link CSV_PREVIEW_MAX_ROWS} rows of a CSV/TSV from storage without
 * ever buffering the whole file. The source stream is destroyed as soon as enough rows are
 * read (one past the cap, to detect truncation), so a multi-GB file costs O(rows) of memory.
 */
export async function getCsvPreviewSlice({
  key,
  context,
  signal,
}: CsvPreviewSliceArgs): Promise<CsvPreviewSlice> {
  const source = await downloadFileStream({ key, context })
  const onAbort = () => source.destroy()
  signal?.addEventListener('abort', onAbort, { once: true })

  const reader = source[Symbol.asyncIterator]()

  try {
    // Pull chunks until the first newline so the delimiter can be sniffed before parsing.
    // Accumulate the header line incrementally — appending each chunk's decoded text rather than
    // re-concatenating the whole buffer each iteration (which would be O(n²) for a header split
    // across many small chunks). The delimiter chars (`,` `\t` `;`) are ASCII, so a multi-byte
    // character split at a chunk boundary can't introduce a false delimiter into the count.
    const sniffed: Buffer[] = []
    let firstLine = ''
    let sniffedBytes = 0
    while (true) {
      const { value, done } = await reader.next()
      if (done) break
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      sniffed.push(chunk)
      sniffedBytes += chunk.length
      const text = chunk.toString('utf-8')
      const nl = text.indexOf('\n')
      if (nl !== -1) {
        firstLine += text.slice(0, nl)
        break
      }
      firstLine += text
      if (sniffedBytes >= DELIMITER_SNIFF_MAX_BYTES) break
    }

    if (sniffed.length === 0) {
      return { headers: [], rows: [], truncated: false }
    }

    const delimiter = detectDelimiter(firstLine)
    const parser = parseCsvStream({
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true,
      cast: false,
      bom: true,
      delimiter,
    })

    // Re-feed the sniffed prefix, then drain the rest of the source into the parser.
    async function* rejoin() {
      for (const chunk of sniffed) yield chunk
      while (true) {
        const { value, done } = await reader.next()
        if (done) return
        yield value
      }
    }
    const piped = Readable.from(rejoin())
    piped.on('error', (err) => parser.destroy(err))
    piped.pipe(parser)

    let headers: string[] = []
    let headersSet = false
    const rows: string[][] = []
    let truncated = false

    for await (const record of parser as AsyncIterable<string[]>) {
      if (!headersSet) {
        headers = record.map(cell)
        headersSet = true
        continue
      }
      if (rows.length >= CSV_PREVIEW_MAX_ROWS) {
        truncated = true
        break
      }
      rows.push(record.map(cell))
    }

    piped.destroy()
    parser.destroy()
    return { headers, rows, truncated }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    source.destroy()
  }
}
