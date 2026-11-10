import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { AutomSearchResult } from '@/tools/autom/types'

/** Reads a `AutomSearchResult` from an untyped Autom API payload. */
export function mapAutomSearchResult(value: unknown): AutomSearchResult | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    position: toNumberOrNull(record.position),
    title: toStringOrNull(record.title),
    link: toStringOrNull(record.link),
    domain: toStringOrNull(record.domain),
    displayedLink: toStringOrNull(record.displayed_link),
    source: toStringOrNull(record.source),
    snippet: toStringOrNull(record.snippet),
    date: toStringOrNull(record.date),
  }
}
