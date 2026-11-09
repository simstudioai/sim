import { createLoader, createSerializer, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { searchFilterParsers } from '@/lib/mothership/chat/search-params'

export const organizationSearchParsers = {
  q: parseAsString.withDefault(''),
  mode: parseAsStringLiteral(['search', 'assistant']),
} as const

/** A query is a filter-like view change, not navigation: replace, and clear when empty. */
export const organizationSearchUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

export interface OrganizationSummaryRequest {
  id: string
  message: string
  assistantSearch: WorkspaceSearchFilters
}

/**
 * Search's two modes. A Search URL names its mode so Back and reload return to it; a bare URL is
 * pinned to the viewer's remembered mode by the server, before the page loads. A client write would
 * be a history update, and Next drops any navigation still pending when one lands.
 */
export type SearchMode = 'search' | 'assistant'

const COOKIE_PREFIX = 'search_mode_'
const COOKIE_MAX_AGE_SECONDS = 31536000

interface SearchUrlState {
  mode: SearchMode | null
  q: string
  source: string | null
  updated: string
}

/** The mode a Search URL names: its own, else Search when it carries a query or filter, else none. */
export function searchModeInUrl({ mode, q, source, updated }: SearchUrlState): SearchMode | null {
  return mode ?? (q || source || updated !== 'any' ? 'search' : null)
}

/** The cookie remembering a viewer's last Search mode in one organization. */
export function searchModeCookieName(organizationId: string) {
  return `${COOKIE_PREFIX}${organizationId}`
}

/** The remembered mode, only when the cookie is `userId`'s: a shared browser keeps each viewer's. */
export function readRememberedSearchMode(
  value: string | undefined,
  userId: string
): SearchMode | null {
  if (!value || !userId) return null
  const separator = value.lastIndexOf(':')
  if (separator < 0 || value.slice(0, separator) !== userId) return null
  const mode = value.slice(separator + 1)
  return mode === 'search' || mode === 'assistant' ? mode : null
}

/** The cookie string that remembers `mode` for the server's next bare Search URL. */
export function rememberedSearchModeCookie(
  organizationId: string,
  userId: string,
  mode: SearchMode
) {
  return `${searchModeCookieName(organizationId)}=${userId}:${mode}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`
}

const loadSearchUrl = createLoader({ ...organizationSearchParsers, ...searchFilterParsers })
const serializeMode = createSerializer(organizationSearchParsers)

/**
 * Where a Search URL that names no mode goes: the same URL pinned to `remembered`, or Search.
 * Null when the URL already names one.
 */
export function pinnedSearchHref(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
  remembered: SearchMode | null
): string | null {
  if (searchModeInUrl(loadSearchUrl(searchParams))) return null
  const base = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    for (const entry of [value ?? []].flat()) base.append(key, entry)
  }
  const query = base.toString()
  return serializeMode(query ? `${pathname}?${query}` : pathname, { mode: remembered ?? 'search' })
}
