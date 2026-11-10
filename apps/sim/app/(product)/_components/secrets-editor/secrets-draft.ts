import { countPasteRows } from '@sim/utils/paste'
import {
  applyVariableEdits,
  createEmptyEnvVar,
  parseEnvVarLine,
  parseValidEnvVars,
  setRecordValue,
  type UIEnvironmentVariable,
} from '@/platform/lib/data/secrets'

/** Saved variables as edited, and the new rows not yet part of them. */
export interface SecretsDraft {
  variables: Record<string, string>
  rows: UIEnvironmentVariable[]
}

const isComplete = (row: UIEnvironmentVariable) => Boolean(row.key && row.value)
const hasContent = (row: UIEnvironmentVariable) => Boolean(row.key || row.value)

function sameRecord(left: Record<string, string>, right: Record<string, string>) {
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
  )
}

/**
 * Blank rows and row identity mean nothing: only what would be saved or lost counts. Rows compare
 * as a list, never by name, so a row that repeats a saved secret still reads as an edit.
 */
export function sameSecretsDraft(left: SecretsDraft, right: SecretsDraft) {
  if (!sameRecord(left.variables, right.variables)) return false
  const leftRows = left.rows.filter(hasContent)
  const rightRows = right.rows.filter(hasContent)
  return (
    leftRows.length === rightRows.length &&
    leftRows.every(
      (row, index) => row.key === rightRows[index].key && row.value === rightRows[index].value
    )
  )
}

/** Names typed into more than one new row: a save would silently keep only the last of them. */
export function duplicateRowKeys(rows: readonly UIEnvironmentVariable[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    if (!row.key) continue
    if (seen.has(row.key)) duplicates.add(row.key)
    seen.add(row.key)
  }
  return duplicates
}

/**
 * What one save writes: the difference between the draft and `baseline`, never the whole set.
 * `saved` is the full set the write leaves behind, with `latest` kept wherever the draft did not
 * touch it, so a scope that saves whole sets never reverts a change it did not make.
 */
export function planSecretsSave(
  baseline: Record<string, string>,
  draft: SecretsDraft,
  latest: Record<string, string> = baseline
) {
  const merged = { ...draft.variables }
  for (const row of draft.rows) {
    if (isComplete(row)) setRecordValue(merged, row.key, row.value)
  }
  const upsert: Record<string, string> = {}
  const remove: string[] = []
  for (const [key, value] of Object.entries(merged)) {
    if (!Object.hasOwn(baseline, key) || baseline[key] !== value) {
      setRecordValue(upsert, key, value)
    }
  }
  for (const key of Object.keys(baseline)) {
    if (!Object.hasOwn(merged, key)) remove.push(key)
  }
  return {
    upsert,
    remove,
    saved: applyVariableEdits(baseline, merged, latest),
    changed: Object.keys(upsert).length > 0 || remove.length > 0,
  }
}

/**
 * The draft after a save: `saved` plus whatever changed since `submitted`. A saved row joins the
 * variables with its current value, and one cleared in the meantime stays out of them, so the draft
 * reads as unsaved rather than silently keeping a value the editor removed.
 */
export function rebaseAfterSecretsSave(
  submitted: SecretsDraft,
  current: SecretsDraft,
  saved: Record<string, string>
): SecretsDraft {
  const sent = new Map(submitted.rows.filter(isComplete).map((row) => [row.id, row]))
  const next = { ...saved }
  for (const row of sent.values()) {
    if (Object.hasOwn(submitted.variables, row.key)) {
      setRecordValue(next, row.key, submitted.variables[row.key])
    } else {
      delete next[row.key]
    }
  }
  const rows: UIEnvironmentVariable[] = []
  for (const row of current.rows) {
    if (sent.has(row.id) && isComplete(row)) setRecordValue(next, row.key, row.value)
    else rows.push(row)
  }
  return {
    variables: applyVariableEdits(submitted.variables, current.variables, next),
    rows: rows.length > 0 ? rows : [createEmptyEnvVar()],
  }
}

/** The editor's changes laid over a newer server value. Rows being typed are never touched. */
export function mergeSecretsDraft(
  mine: SecretsDraft,
  base: SecretsDraft,
  theirs: SecretsDraft
): SecretsDraft {
  return {
    variables: applyVariableEdits(base.variables, mine.variables, theirs.variables),
    rows: mine.rows,
  }
}

/** Removes one new row, keeping an empty row at the end to type into. */
export function removeSecretRow(
  rows: readonly UIEnvironmentVariable[],
  index: number
): UIEnvironmentVariable[] {
  const remaining = rows.filter((_, position) => position !== index)
  const last = remaining.at(-1)
  return last && !hasContent(last) ? remaining : [...remaining, createEmptyEnvVar()]
}

/** How a paste into a secret field is handled. `native` leaves it to the browser. */
export type SecretsPaste =
  | { kind: 'native' }
  | { kind: 'too-many' }
  | { kind: 'rows'; rows: UIEnvironmentVariable[] }

/**
 * Only `KEY=VALUE` lines are taken over as new rows; plain text, and a pattern whose values are all
 * empty (`KEY=`), paste natively. A paste with more than `maxRows` rows is refused whole.
 */
export function planSecretsPaste(text: string, maxRows: number): SecretsPaste {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'native' }
  if (countPasteRows(trimmed, maxRows) > maxRows) return { kind: 'too-many' }
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim())
  if (!lines.some((line) => parseEnvVarLine(line) !== null)) return { kind: 'native' }
  const rows = parseValidEnvVars(lines)
  return rows.length > 0 ? { kind: 'rows', rows } : { kind: 'native' }
}

/** The pasted rows replace the blank ones, with a fresh empty row to type into after them. */
export function appendPastedRows(
  rows: readonly UIEnvironmentVariable[],
  pasted: readonly UIEnvironmentVariable[]
): UIEnvironmentVariable[] {
  return [...rows.filter(hasContent), ...pasted, createEmptyEnvVar()]
}
