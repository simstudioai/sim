import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type {
  AutomKnowledgeGraph,
  AutomLocation,
  AutomPlace,
  AutomSearchResult,
  AutomSuggestion,
} from '@/tools/autom/types'

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

/** Reads a `AutomKnowledgeGraph` from an untyped Autom API payload. */
export function mapAutomKnowledgeGraph(value: unknown): AutomKnowledgeGraph | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    title: toStringOrNull(record.title),
    type: toStringOrNull(record.type),
    website: toStringOrNull(record.website),
  }
}

/** Reads a `AutomPlace` from an untyped Autom API payload. */
export function mapAutomPlace(value: unknown): AutomPlace | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    title: toStringOrNull(record.title),
    address: toStringOrNull(record.address),
    website: toStringOrNull(record.website),
    phoneNumber: toStringOrNull(record.phone_number),
    latitude: toNumberOrNull(record.lat),
    longitude: toNumberOrNull(record.long),
    placeId: toStringOrNull(record.fid),
  }
}

/** Reads a `AutomSuggestion` from an untyped Autom API payload. */
export function mapAutomSuggestion(value: unknown): AutomSuggestion | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    value: toStringOrNull(record.value),
  }
}

/** Reads a `AutomLocation` from an untyped Autom API payload. */
export function mapAutomLocation(value: unknown): AutomLocation | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    canonicalName: toStringOrNull(record.canonical_name),
    name: toStringOrNull(record.name),
    targetType: toStringOrNull(record.target_type),
    countryCode: toStringOrNull(record.country_code),
    reach: toNumberOrNull(record.reach),
    googleId: toNumberOrNull(record.google_id),
  }
}
