import { createLogger } from '@sim/logger'

const logger = createLogger('GooglePagination')

/**
 * Thrown by {@link drainGooglePagedList} when a page request returns a non-OK
 * HTTP status. Carries the status and parsed error body so callers can shape
 * their existing error responses unchanged.
 */
export class GooglePageError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`Google API error: ${status}`)
    this.name = 'GooglePageError'
    this.status = status
    this.body = body
  }
}

/**
 * Result of draining a token-paginated Google REST list endpoint.
 */
export interface GoogleDrainResult<T> {
  /** All items accumulated across every fetched page. */
  items: T[]
  /** True when the page cap was reached before the API stopped returning a token. */
  truncated: boolean
}

/**
 * Options for {@link drainGooglePagedList}.
 */
export interface DrainGooglePagedListOptions<T, R> {
  /**
   * Builds the request URL for a given page. `pageToken` is `undefined` for the
   * first page, then the value of the previous response's `nextPageToken`.
   */
  buildUrl: (pageToken: string | undefined) => string
  /** Performs the HTTP request for a built URL. */
  fetch: (url: string) => Promise<Response>
  /** Parses an error body from a non-OK response (used to build {@link GooglePageError}). */
  parseError: (response: Response) => Promise<unknown>
  /** Extracts the array of items from a single page's JSON body. */
  getItems: (body: R) => T[] | undefined
  /** Reads the continuation token from a single page's JSON body. */
  getNextPageToken: (body: R) => string | undefined
  /** Maximum number of pages to fetch before stopping and flagging `truncated`. */
  maxPages: number
  /** Label used in the cap-reached warning log. */
  label: string
}

/**
 * Drains a token-paginated Google REST list endpoint, following each response's
 * `nextPageToken` until it is absent or the `maxPages` cap is hit.
 *
 * Mirrors the bounded-loop pattern used by the Slack channels selector: the loop
 * is bounded and emits a `logger.warn` (and sets `truncated`) when the cap is
 * reached rather than silently dropping items. A non-OK page response throws a
 * {@link GooglePageError} carrying the status and parsed body so callers preserve
 * their existing error-response shapes.
 */
export async function drainGooglePagedList<T, R>(
  options: DrainGooglePagedListOptions<T, R>
): Promise<GoogleDrainResult<T>> {
  const {
    buildUrl,
    fetch: fetchPage,
    parseError,
    getItems,
    getNextPageToken,
    maxPages,
    label,
  } = options

  const items: T[] = []
  let pageToken: string | undefined
  let truncated = false

  for (let page = 0; page < maxPages; page++) {
    const response = await fetchPage(buildUrl(pageToken))

    if (!response.ok) {
      throw new GooglePageError(response.status, await parseError(response))
    }

    const body = (await response.json()) as R

    const pageItems = getItems(body)
    if (pageItems?.length) {
      items.push(...pageItems)
    }

    pageToken = getNextPageToken(body)?.trim() || undefined
    if (!pageToken) {
      return { items, truncated }
    }

    if (page === maxPages - 1) {
      truncated = true
      logger.warn(`${label}: hit pagination cap of ${maxPages} pages; results may be incomplete`)
    }
  }

  return { items, truncated }
}
