import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { NativeDocument, NativeSearchInput } from '@/lib/sim-search/live/types'

/** The generic date range uses the source's useful timeline; update filters stay independent. */
export function sourceDate(document: NativeDocument, provider: string): string | undefined {
  const value = provider === 'google_calendar' ? document.eventStartAt : document.modifiedAt
  return value && Number.isFinite(Date.parse(value)) ? value : undefined
}

export function sourceDateType(
  provider: string,
  document: NativeDocument
): 'event_start' | 'message' | 'modified' {
  return provider === 'google_calendar'
    ? 'event_start'
    : provider === 'gmail' || (provider === 'slack' && document.kind !== 'file')
      ? 'message'
      : 'modified'
}

export function hasDateBounds(filters?: WorkspaceSearchFilters): boolean {
  return Boolean(
    filters?.startDate || filters?.endDate || filters?.modifiedAfter || filters?.modifiedBefore
  )
}

/** Native bounds may be widened for provider precision; returned metadata is checked exactly. */
export function nativeDateBounds(input: NativeSearchInput): { start?: string; end?: string } {
  const filters = input.filters
  const start = [filters?.startDate, filters?.modifiedAfter]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
  const end = [filters?.endDate, filters?.modifiedBefore]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  return {
    ...(start ? { start: new Date(start).toISOString() } : {}),
    ...(end ? { end: new Date(end).toISOString() } : {}),
  }
}

/** Calendar and provider dates are checked separately from the record's modification date. */
export function matchesSourceDates(
  document: NativeDocument,
  provider: string,
  filters?: WorkspaceSearchFilters
): boolean {
  if (!filters?.startDate && !filters?.endDate) return true
  const date = Date.parse(sourceDate(document, provider) ?? '')
  return (
    Number.isFinite(date) &&
    (!filters.startDate || date >= Date.parse(filters.startDate)) &&
    (!filters.endDate || date < Date.parse(filters.endDate))
  )
}

/** Date-only native filters can safely omit the text clause instead of searching a literal wildcard. */
export function nativeText(input: NativeSearchInput): string {
  return (input.native?.query ?? input.query).trim()
}
