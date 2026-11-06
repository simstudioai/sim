import {
  applyVariableEdits,
  createEmptyEnvVar,
  type UIEnvironmentVariable,
} from '@/components/secrets/secret-rows'
import { setRecordValue } from '@/lib/core/utils/records'

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

/** Blank rows and row identity mean nothing: only what would be saved or lost counts. */
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

/** What one save writes: the difference between the draft and `baseline`, never the whole set. */
export function planSecretsSave(baseline: Record<string, string>, draft: SecretsDraft) {
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
  return { merged, upsert, remove, changed: Object.keys(upsert).length > 0 || remove.length > 0 }
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
