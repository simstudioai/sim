import { isRecordLike } from '@sim/utils/object'
import type { OutputFormat } from '../../config/index'
import { printRecord, text } from '../../output/render'

/** One result value as a field: a record, or a list holding one, as compact JSON. */
function fieldText(value: unknown): string {
  const nested = Array.isArray(value) ? value.some(isRecordLike) : isRecordLike(value)
  return text(nested ? JSON.stringify(value) : value)
}

export function printProtocolResult(format: OutputFormat, result: Record<string, unknown>): void {
  const fields = Object.entries(result).map<[string, string]>(([key, value]) => [
    key,
    fieldText(value),
  ])
  printRecord(format, fields, result)
}
