/**
 * Streaming CSV parsing — server-only.
 *
 * Split from `lib/table/import.ts` because the streaming `parse` export of
 * `csv-parse` is a Node `Transform`, so a value import pins Next's stream
 * polyfills (~35 KB gzip) into any client bundle that reaches it — and
 * `lib/table/index.ts` re-exports `import.ts` to plenty of client code. This
 * module is deliberately NOT re-exported from the `lib/table` barrel; the two
 * consumers (the import runner and the import orchestration) are server-only
 * and import it directly. The client CSV dialog keeps using the dynamic
 * `csv-parse/sync` path and is unaffected.
 */

import { type Parser, parse as parseCsvStream } from 'csv-parse'
import { type CsvSkippedRecord, csvParseOptions } from '@/lib/table/import'

/**
 * Returns a streaming `csv-parse` parser (a `Transform`/async-iterable). Pipe a
 * file stream into it and iterate records with `for await`; backpressure flows
 * back to the source while each record is processed. Use this for HTTP uploads
 * so the file is never fully buffered in memory.
 *
 * `onHeaders` fires once, before the first record, with the full header row.
 * `onSkip` fires once per source record the parser had to drop.
 */
export function createCsvParser(
  delimiter = ',',
  onHeaders?: (headers: string[]) => void,
  onSkip?: (skipped: CsvSkippedRecord) => void
): Parser {
  return parseCsvStream(csvParseOptions(delimiter, onHeaders, onSkip))
}
