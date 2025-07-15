import { env } from '@/lib/env'
import { isTest } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { HttpMethod, TableRow, ToolConfig } from '../types'
import type { RequestParams, RequestResponse } from './types'

const logger = createLogger('HTTPRequestTool')

const getReferer = (): string => {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  try {
    return getBaseUrl()
  } catch (_error) {
    return env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  }
}

/**
 * Creates a set of default headers used in HTTP requests
 * @param customHeaders Additional user-provided headers to include
 * @param url Target URL for the request (used for setting Host header)
 * @returns Record of HTTP headers
 */
const getDefaultHeaders = (
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
const processUrl = (
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
const shouldUseProxy = (url: string): boolean => {
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

// Default headers that will be applied if not explicitly overridden by user
const _DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Sec-Ch-Ua': '"Chromium"v="135", "Not-A.Brand"v="8"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
}

/**
 * Transforms a table from the store format to a key-value object
 * Local copy of the function to break circular dependencies
 * @param table Array of table rows from the store
 * @returns Record of key-value pairs
 */
const transformTable = (table: TableRow[] | null): Record<string, any> => {
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

export const requestTool: ToolConfig<RequestParams, RequestResponse> = {
  id: 'http_request',
  name: 'HTTP Request',
  description:
    'Make HTTP requests with comprehensive support for methods, headers, query parameters, path parameters, and form data. Features configurable timeout and status validation for robust API interactions.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      description: 'The URL to send the request to',
    },
    method: {
      type: 'string',
      default: 'GET',
      description: 'HTTP method (GET, POST, PUT, PATCH, DELETE)',
    },
    headers: {
      type: 'object',
      description: 'HTTP headers to include',
    },
    body: {
      type: 'object',
      description: 'Request body (for POST, PUT, PATCH)',
    },
    params: {
      type: 'object',
      description: 'URL query parameters to append',
    },
    pathParams: {
      type: 'object',
      description: 'URL path parameters to replace (e.g., :id in /users/:id)',
    },
    formData: {
      type: 'object',
      description: 'Form data to send (will set appropriate Content-Type)',
    },
    timeout: {
      type: 'number',
      default: 10000,
      description: 'Request timeout in milliseconds',
    },
    validateStatus: {
      type: 'object',
      description: 'Custom status validation function',
    },
  },

  // Direct execution to bypass server for HTTP requests
  directExecution: async (params: RequestParams): Promise<RequestResponse | undefined> => {
    try {
      // Process the URL with parameters
      const url = processUrl(params.url, params.pathParams, params.params)

      // Update the URL in params for any subsequent operations
      params.url = url

      // Determine if we should use the proxy
      if (shouldUseProxy(url)) {
        let proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`

        if (params.method) {
          proxyUrl += `&method=${encodeURIComponent(params.method)}`
        }

        if (params.body && ['POST', 'PUT', 'PATCH'].includes(params.method?.toUpperCase() || '')) {
          const bodyStr =
            typeof params.body === 'string' ? params.body : JSON.stringify(params.body)
          proxyUrl += `&body=${encodeURIComponent(bodyStr)}`
        }

        // Forward all headers as URL parameters
        const userHeaders = transformTable(params.headers || null)

        // Add all custom headers as query parameters
        for (const [key, value] of Object.entries(userHeaders)) {
          if (value !== undefined && value !== null) {
            proxyUrl += `&header.${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
          }
        }

        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        const result = await response.json()

        // Transform the proxy result to match the expected output format
        return {
          success: result.success,
          output: {
            data: result.data,
            status: result.status,
            headers: result.headers || {},
          },
          error: result.success
            ? undefined
            : // Extract and display the actual API error message from the response if available
              result.data && typeof result.data === 'object' && result.data.error
              ? `HTTP error ${result.status}: ${result.data.error.message || JSON.stringify(result.data.error)}`
              : result.error || `HTTP error ${result.status}`,
        }
      }

      // For non-proxied requests, proceed with normal fetch
      const userHeaders = transformTable(params.headers || null)
      const headers = getDefaultHeaders(userHeaders, url)

      const fetchOptions: RequestInit = {
        method: params.method || 'GET',
        headers,
        redirect: 'follow',
      }

      // Add body for non-GET requests
      if (params.method && params.method !== 'GET' && params.body) {
        if (typeof params.body === 'object') {
          fetchOptions.body = JSON.stringify(params.body)
          // Ensure Content-Type is set
          headers['Content-Type'] = 'application/json'
        } else {
          fetchOptions.body = params.body
        }
      }

      // Handle form data
      if (params.formData) {
        const formData = new FormData()
        Object.entries(params.formData).forEach(([key, value]) => {
          formData.append(key, value)
        })
        fetchOptions.body = formData
      }

      // Handle timeout
      const controller = new AbortController()
      const timeout = params.timeout || 120000
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      fetchOptions.signal = controller.signal

      try {
        // Make the fetch request
        const response = await fetch(url, fetchOptions)
        clearTimeout(timeoutId)

        // Convert Headers to a plain object
        const responseHeaders: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value
        })

        // Parse response based on content type
        let data
        try {
          if (response.headers.get('content-type')?.includes('application/json')) {
            data = await response.json()
          } else {
            data = await response.text()
          }
        } catch (_error) {
          data = await response.text()
        }

        return {
          success: response.ok,
          output: {
            data,
            status: response.status,
            headers: responseHeaders,
          },
          error: response.ok ? undefined : `HTTP error ${response.status}: ${response.statusText}`,
        }
      } catch (error: any) {
        clearTimeout(timeoutId)

        // Handle specific abort error
        if (error.name === 'AbortError') {
          return {
            success: false,
            output: {
              data: null,
              status: 0,
              headers: {},
            },
            error: `Request timeout after ${timeout}ms`,
          }
        }

        return {
          success: false,
          output: {
            data: null,
            status: 0,
            headers: {},
          },
          error: error.message || 'Failed to fetch',
        }
      }
    } catch (error: any) {
      return {
        success: false,
        output: {
          data: null,
          status: 0,
          headers: {},
        },
        error: error.message || 'Error preparing HTTP request',
      }
    }
  },

  request: {
    url: (params: RequestParams) => {
      // Process the URL first to handle path/query params
      const processedUrl = processUrl(params.url, params.pathParams, params.params)

      // For external URLs that need proxying
      if (shouldUseProxy(processedUrl)) {
        let proxyUrl = `/api/proxy?url=${encodeURIComponent(processedUrl)}`

        if (params.method) {
          proxyUrl += `&method=${encodeURIComponent(params.method)}`
        }

        if (params.body && ['POST', 'PUT', 'PATCH'].includes(params.method?.toUpperCase() || '')) {
          const bodyStr =
            typeof params.body === 'string' ? params.body : JSON.stringify(params.body)
          proxyUrl += `&body=${encodeURIComponent(bodyStr)}`
        }

        // Forward all headers as URL parameters
        const userHeaders = transformTable(params.headers || null)
        for (const [key, value] of Object.entries(userHeaders)) {
          if (value !== undefined && value !== null) {
            proxyUrl += `&header.${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
          }
        }

        return proxyUrl
      }

      return processedUrl
    },

    method: 'GET' as HttpMethod,

    headers: (params: RequestParams) => {
      const headers = transformTable(params.headers || null)

      // For proxied requests, we only need minimal headers
      if (shouldUseProxy(params.url)) {
        return {
          'Content-Type': 'application/json',
        }
      }

      // For direct requests, add all our standard headers
      const allHeaders = getDefaultHeaders(headers, params.url)

      // Set appropriate Content-Type
      if (params.formData) {
        // Don't set Content-Type for FormData, browser will set it with boundary
        return allHeaders
      }
      if (params.body) {
        allHeaders['Content-Type'] = 'application/json'
      }

      return allHeaders
    },

    body: (params: RequestParams) => {
      // For proxied requests, we don't need a body
      if (shouldUseProxy(params.url)) {
        return undefined
      }

      if (params.formData) {
        const formData = new FormData()
        Object.entries(params.formData).forEach(([key, value]) => {
          formData.append(key, value)
        })
        return formData
      }

      if (params.body) {
        return params.body
      }

      return undefined
    },
  },

  transformResponse: async (response: Response) => {
    // For proxy responses, we need to parse the JSON and extract the data
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const jsonResponse = await response.json()

      // Check if this is a proxy response
      if (jsonResponse.data !== undefined && jsonResponse.status !== undefined) {
        return {
          success: jsonResponse.success,
          output: {
            data: jsonResponse.data,
            status: jsonResponse.status,
            headers: jsonResponse.headers || {},
          },
        }
      }
    }

    // Standard response handling
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const data = await (contentType.includes('application/json')
      ? response.json()
      : response.text())

    return {
      success: response.ok,
      output: {
        data,
        status: response.status,
        headers,
      },
    }
  },

  transformError: (error) => {
    // If there's detailed error info from the API response, use it
    if (error.response?.data) {
      // Handle structured error objects from APIs
      if (typeof error.response.data === 'object' && error.response.data.error) {
        const apiError = error.response.data.error
        const message =
          apiError.message || (typeof apiError === 'string' ? apiError : JSON.stringify(apiError))
        return `${error.status || ''} ${message}`.trim()
      }

      // For text error responses
      if (typeof error.response.data === 'string' && error.response.data.trim()) {
        return `${error.status || ''} ${error.response.data}`.trim()
      }
    }

    // Fall back to standard error formatting
    const message = error.message || error.error?.message || 'Unknown error'
    const code = error.status || error.error?.status
    const statusText = error.statusText || ''

    // Format the error message
    return code ? `HTTP error ${code}${statusText ? `: ${statusText}` : ''} - ${message}` : message
  },
}
