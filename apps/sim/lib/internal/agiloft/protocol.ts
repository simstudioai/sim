/**
 * Parses Agiloft's `EWREST_` response format.
 *
 * The legacy `/ewws/EW*` operations answer with a body of JavaScript assignments
 * rather than JSON — the interface was designed to be `eval`-ed by a browser
 * client. The documented shapes are:
 *
 *   EWCreate  ->  EWREST_id='353';
 *   EWRead    ->  EWREST_full_name='John Doe';
 *                 EWREST_id='358';
 *   EWSelect  ->  EWREST_id_length = '3';
 *                 EWREST_id_0 = '150';
 *   EWSearch  ->  EWREST_length = '4';
 *                 EWREST_summary_0='Upgrading Our Software';
 *
 * Note the inconsistent spacing around `=`: the record-field forms have none,
 * the `_length` and indexed-id forms in the Select/Search examples do. Both are
 * accepted here.
 */

/**
 * Matches one `EWREST_key='value';` assignment anywhere in the body. Most
 * responses put one per line, but EWActionButton documents both of its
 * assignments on a single line, so the scan is not line-anchored. The value is
 * non-greedy up to the closing `';` for the same reason.
 */
const ASSIGNMENT = /EWREST_(?<key>[^=\s']+)\s*=\s*'(?<value>[\s\S]*?)'\s*;/g

/**
 * Parses a body into its raw `EWREST_` key/value pairs, preserving document
 * order. Lines that are blank or do not match the assignment form are skipped,
 * so a trailing newline or an incidental banner does not abort the parse.
 */
export function parseEwRest(body: string): Map<string, string> {
  const values = new Map<string, string>()

  for (const match of body.matchAll(ASSIGNMENT)) {
    const key = match.groups?.key
    if (!key) continue
    values.set(key, match.groups?.value ?? '')
  }

  return values
}

/**
 * Reads the `EWREST_id_length` / `EWREST_id_<n>` pairs EWSelect returns. A
 * result of zero records is reported as `EWREST_id_length = '0';` with no
 * indexed entries.
 */
/**
 * True when the body carries at least one `EWREST_` assignment. Used where a
 * binary payload is expected, since a refusal arrives as an assignment or
 * plain text instead of file bytes.
 */
export function isEwRestBody(body: string): boolean {
  return parseEwRest(body).size > 0
}

export function toRecordIds(values: Map<string, string>): {
  recordIds: string[]
  count: number
} {
  const recordIds: string[] = []
  for (let index = 0; ; index++) {
    const id = values.get(`id_${index}`)
    if (id === undefined) break
    recordIds.push(id)
  }

  /**
   * Report what was actually parsed rather than the declared length. A
   * declared count that disagrees with the rows present means the body was
   * truncated, and returning the larger number would hide that from callers
   * who compare `totalCount` against `recordIds.length`.
   */
  return { recordIds, count: recordIds.length }
}
