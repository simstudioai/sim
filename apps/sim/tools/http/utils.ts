import { getEnv } from '@/lib/env'
import { isTest } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { TableRow } from '@/tools/types'

const logger = createLogger('HTTPRequestUtils')

export const getReferer = (): string => {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  try {
    return getBaseUrl()
  } catch (_error) {
    return getEnv('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'
  }
}

/**
 * Creates a set of default headers used in HTTP requests
 * @param customHeaders Additional user-provided headers to include
 * @param url Target URL for the request (used for setting Host header)
 * @returns Record of HTTP headers
 */
export const getDefaultHeaders = (
  customHeaders: Record<string, string> = {},
  url?: string
): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    Referer: getReferer(),
    'Sec-Ch-Ua': 'Chromium;v=91, Not-A.Brand;v=99',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    ...customHeaders,
  }

  // Add Host header if not provided and URL is valid
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
  queryParams?: TableRow[] | null
): string => {
  // Strip any surrounding quotes
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1)
  }

  // Replace path parameters
  if (pathParams) {
    Object.entries(pathParams).forEach(([key, value]) => {
      url = url.replace(`:${key}`, encodeURIComponent(value))
    })
  }

  // Handle query parameters
  if (queryParams) {
    const queryParamsObj = transformTable(queryParams)

    // Verify if URL already has query params to use proper separator
    const separator = url.includes('?') ? '&' : '?'

    // Build query string manually to avoid double-encoding issues
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

// Check if a URL needs proxy to avoid CORS/method restrictions
export const shouldUseProxy = (url: string): boolean => {
  // Skip proxying in test environment
  if (isTest) {
    return false
  }

  // Only consider proxying in browser environment
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const _urlObj = new URL(url)
    const currentOrigin = window.location.origin

    // Don't proxy same-origin or localhost requests
    if (url.startsWith(currentOrigin) || url.includes('localhost')) {
      return false
    }

    return true // Proxy all cross-origin requests for consistency
  } catch (e) {
    logger.warn('URL parsing failed:', e)
    return false
  }
}

/**
 * Transforms a table from the store format to a key-value object
 * Local copy of the function to break circular dependencies
 * @param table Array of table rows from the store
 * @returns Record of key-value pairs
 */
export const transformTable = (table: TableRow[] | null): Record<string, any> => {
  if (!table) return {}

  return table.reduce(
    (acc, row) => {
      if (row.cells?.Key && row.cells?.Value !== undefined) {
        // Extract the Value cell as is - it should already be properly resolved
        // by the InputResolver based on variable type (number, string, boolean etc.)
        const value = row.cells.Value

        // Store the correctly typed value in the result object
        acc[row.cells.Key] = value
      }
      return acc
    },
    {} as Record<string, any>
  )
}
