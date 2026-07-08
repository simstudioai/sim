import type { OutputProperty } from '@/tools/types'

/**
 * Shared helpers and types for all Sportmonks APIs (football, motorsport, odds,
 * core). This module is intentionally vendor-generic — it carries no
 * sport-specific base URL or entity shapes. Each Sportmonks integration lives in
 * its own `sportmonks_{api}` directory and imports these helpers from here.
 */

/**
 * Parameters shared by every Sportmonks tool. The API token is sent via the
 * `Authorization` header, while `include`/`filters` are appended to the query.
 */
export interface SportmonksBaseParams {
  apiKey: string
  include?: string
  filters?: string
}

/** Pagination/ordering query parameters supported by paginated list endpoints. */
export interface SportmonksPaginationParams {
  per_page?: string
  page?: string
  order?: string
}

/**
 * Sportmonks v3 pagination metadata returned alongside paginated list responses.
 * @see https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/introduction/pagination
 */
export interface SportmonksPagination {
  count?: number
  per_page?: number
  current_page?: number
  next_page?: string | null
  has_more?: boolean
}

/** Builds the auth headers for a Sportmonks request. */
export function buildSportmonksHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: apiKey,
    Accept: 'application/json',
  }
}

/** Appends the shared Sportmonks query parameters (include, filters, pagination). */
export function appendSportmonksQuery(
  url: string,
  params: SportmonksBaseParams & SportmonksPaginationParams
): string {
  const query = new URLSearchParams()
  if (params.include) query.append('include', params.include)
  if (params.filters) query.append('filters', params.filters)
  if (params.per_page) query.append('per_page', params.per_page)
  if (params.page) query.append('page', params.page)
  if (params.order) query.append('order', params.order)
  const queryString = query.toString()
  return queryString ? `${url}?${queryString}` : url
}

/** Normalizes a Sportmonks error response into a thrown Error. */
export function handleSportmonksError(data: any, status: number, operation: string): never {
  const errorMessage =
    data?.message || data?.error?.message || data?.error || `Unknown error during ${operation}`
  throw new Error(`Sportmonks ${operation} failed (${status}): ${errorMessage}`)
}

/** Output property definitions for the pagination metadata block. */
export const SPORTMONKS_PAGINATION_PROPERTIES = {
  count: { type: 'number', description: 'Number of results on the current page', optional: true },
  per_page: { type: 'number', description: 'Number of results per page', optional: true },
  current_page: { type: 'number', description: 'Current page number', optional: true },
  next_page: {
    type: 'string',
    description: 'URL of the next page of results',
    nullable: true,
    optional: true,
  },
  has_more: { type: 'boolean', description: 'Whether more pages are available', optional: true },
} as const satisfies Record<string, OutputProperty>

/** Full pagination output definition reused across paginated list tools. */
export const SPORTMONKS_PAGINATION_OUTPUT = {
  type: 'object' as const,
  description: 'Pagination metadata (present on paginated endpoints)',
  optional: true,
  properties: SPORTMONKS_PAGINATION_PROPERTIES,
}
