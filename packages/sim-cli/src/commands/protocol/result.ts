import { isRecordLike } from '@sim/utils/object'
import type { OutputFormat } from '../../config/index'
import { printRecord, sanitize, text } from '../../output/render'

/** One result value as a field: a record, or a list holding one, as compact JSON. */
function fieldText(value: unknown): string {
  const nested = Array.isArray(value) ? value.some(isRecordLike) : isRecordLike(value)
  return text(nested ? JSON.stringify(value) : value)
}

/**
 * Prints a protocol command's result: the record itself in a machine format, else one line per
 * field, with `display` replacing the text of the fields it names (a list a person reads as a
 * sentence rather than as JSON). An override is built from server text (resource keys, ids), so it
 * is sanitized like every other field.
 */
export function printProtocolResult(
  format: OutputFormat,
  result: Record<string, unknown>,
  display: Readonly<Record<string, string>> = {}
): void {
  const fields = Object.entries(result).map<[string, string]>(([key, value]) => [
    key,
    display[key] === undefined ? fieldText(value) : sanitize(display[key]),
  ])
  printRecord(format, fields, result)
}
