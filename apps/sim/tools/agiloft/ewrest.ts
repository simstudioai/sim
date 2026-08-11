/**
 * Parser for Agiloft's `EWREST_` response format.
 *
 * Every `/ewws/EW*` operation answers with a body of JavaScript assignments
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

const ASSIGNMENT = /^EWREST_(?<key>[^=\s]+)\s*=\s*'(?<value>[\s\S]*)';?$/

/**
 * Parses a body into its raw `EWREST_` key/value pairs, preserving document
 * order. Lines that are blank or do not match the assignment form are skipped,
 * so a trailing newline or an incidental banner does not abort the parse.
 */
export function parseEwRest(body: string): Map<string, string> {
  const values = new Map<string, string>()

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const match = ASSIGNMENT.exec(line)
    const key = match?.groups?.key
    if (!key) continue

    values.set(key, match.groups?.value ?? '')
  }

  return values
}

/**
 * True when the body carries at least one `EWREST_` assignment. Agiloft answers
 * some failures with HTTP 200 and a plain-text error, so callers use this to
 * tell "no data" apart from "not an EWREST response at all".
 */
export function isEwRestBody(body: string): boolean {
  return parseEwRest(body).size > 0
}

/**
 * Splits a parsed record into its ID and the remaining field values. EWRead and
 * EWUpdate both return the whole record with `id` among the fields.
 */
export function toRecord(values: Map<string, string>): {
  id: string | null
  fields: Record<string, string>
} {
  const fields: Record<string, string> = {}
  for (const [key, value] of values) {
    fields[key] = value
  }
  return { id: fields.id ?? null, fields }
}

/**
 * Regroups the flat `EWREST_<field>_<index>` assignments EWSearch returns into
 * one object per record. `EWREST_length` gives the row count for the current
 * page; when it is absent the highest observed index is used instead so a
 * partial body still yields the rows it did contain.
 */
export function toSearchRecords(values: Map<string, string>): {
  records: Record<string, string>[]
  count: number
} {
  const INDEXED = /^(?<field>.+)_(?<index>\d+)$/
  const byIndex = new Map<number, Record<string, string>>()

  for (const [key, value] of values) {
    if (key === 'length' || key === 'id_length') continue

    const match = INDEXED.exec(key)
    const field = match?.groups?.field
    if (!field) continue

    const index = Number(match.groups?.index)
    let record = byIndex.get(index)
    if (!record) {
      record = {}
      byIndex.set(index, record)
    }
    record[field] = value
  }

  const declared = Number(values.get('length') ?? values.get('id_length'))
  const count = Number.isFinite(declared) ? declared : byIndex.size

  const records: Record<string, string>[] = []
  for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
    records.push(byIndex.get(index) as Record<string, string>)
  }

  return { records, count }
}

/**
 * Reads the `EWREST_id_length` / `EWREST_id_<n>` pairs EWSelect returns. A
 * result of zero records is reported as `EWREST_id_length = '0';` with no
 * indexed entries.
 */
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

  const declared = Number(values.get('id_length'))
  return {
    recordIds,
    count: Number.isFinite(declared) ? declared : recordIds.length,
  }
}
