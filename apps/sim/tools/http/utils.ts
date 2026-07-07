import { transformTable } from '@/tools/shared/table'
import type { TableRow } from '@/tools/types'

/**
 * Creates a set of default headers used in HTTP requests.
 *
 * Identifies as Sim rather than impersonating a browser — browser-fingerprint
 * headers (Referer, Sec-Ch-Ua*) trip anti-CSRF/bot-defense heuristics on
 * providers like Atlassian, which explicitly reject REST calls carrying a
 * browser User-Agent. See https://support.atlassian.com/jira/kb/rest-api-calls-with-a-browser-user-agent-header-may-fail-csrf-checks/
 * @param customHeaders Additional user-provided headers to include
 * @param url Target URL for the request (used for setting Host header)
 * @returns Record of HTTP headers
 */
export const getDefaultHeaders = (
  customHeaders: Record<string, string> = {},
  url?: string
): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent': 'Sim/1.0 (+https://sim.ai)',
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...customHeaders,
  }

  if (url) {
    try {
      const hostname = new URL(url).host
      if (hostname && !customHeaders.Host && !customHeaders.host) {
        headers.Host = hostname
      }
    } catch (_e) {
      // Invalid URL, will be caught later
    }
  }

  return headers
}

/**
 * Processes a URL with path parameters and query parameters
 * @param url Base URL to process
 * @param pathParams Path parameters to replace in the URL
 * @param queryParams Query parameters to add to the URL
 * @returns Processed URL with path params replaced and query params added
 */
export const processUrl = (
  url: string,
  pathParams?: Record<string, string>,
  queryParams?: TableRow[] | Record<string, any> | string | null
): string => {
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1)
  }

  if (pathParams) {
    Object.entries(pathParams).forEach(([key, value]) => {
      url = url.replace(`:${key}`, encodeURIComponent(value))
    })
  }

  if (queryParams) {
    const queryParamsObj = transformTable(queryParams)

    const separator = url.includes('?') ? '&' : '?'

    const queryParts: string[] = []

    for (const [key, value] of Object.entries(queryParamsObj)) {
      if (value !== undefined && value !== null) {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      }
    }

    if (queryParts.length > 0) {
      url += separator + queryParts.join('&')
    }
  }

  return url
}
