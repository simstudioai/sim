import { transformTable } from '@/tools/shared/table'
import type { TableRow } from '@/tools/types'

const FIRST_PARTY_API_HOST_REWRITES: Readonly<Record<string, string>> = {
  'https://sim.ai': 'www.sim.ai',
  'https://staging.sim.ai': 'www.staging.sim.ai',
  'https://dev.sim.ai': 'www.dev.sim.ai',
}
const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
])
const CREDENTIAL_HEADER_SEGMENT =
  /(^|[-_])(?:api[-_]?key|auth(?:orization)?|access[-_]?token|token|cookie|secret)(?:$|[-_])/i

/** Returns custom header names that conventionally carry credentials. */
export function getCredentialHeaderNames(
  headers: TableRow[] | Record<string, unknown> | string | null | undefined
): string[] {
  return Object.keys(transformTable(headers ?? null)).filter((name) => {
    const normalized = name.toLowerCase()
    return CREDENTIAL_HEADER_NAMES.has(normalized) || CREDENTIAL_HEADER_SEGMENT.test(normalized)
  })
}

/** Avoids Sim's environment-specific apex-to-www redirects for first-party API requests. */
export function canonicalizeFirstPartyApiUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const canonicalHost = FIRST_PARTY_API_HOST_REWRITES[parsed.origin]
    if (canonicalHost && (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/'))) {
      parsed.hostname = canonicalHost
      return parsed.toString()
    }
  } catch {}
  return url
}

/**
 * Creates a set of default headers used in HTTP requests.
 *
 * Identifies as Sim rather than impersonating a browser. Browser-fingerprint
 * headers (Referer, Sec-Ch-Ua*) trip anti-CSRF/bot-defense heuristics on
 * providers like Atlassian, which reject REST calls carrying a browser
 * User-Agent regardless of X-Atlassian-Token. See
 * https://support.atlassian.com/jira/kb/rest-api-calls-with-a-browser-user-agent-header-may-fail-csrf-checks/
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

  return canonicalizeFirstPartyApiUrl(url)
}
