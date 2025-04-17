import { HttpMethod, TableRow, ToolConfig, ToolResponse } from '../types'

const getReferer = (): string => {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  
  return 'http://localhost:3000/'
}

// Default headers that will be applied if not explicitly overridden by user
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Sec-Ch-Ua': '"Chromium"v="135", "Not-A.Brand"v="8"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"'
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

export interface RequestParams {
  url: string
  method?: HttpMethod
  headers?: TableRow[]
  body?: any
  params?: TableRow[]
  pathParams?: Record<string, string>
  formData?: Record<string, string | Blob>
  timeout?: number
  validateStatus?: (status: number) => boolean
}

export interface RequestResponse extends ToolResponse {
  output: {
    data: any
    status: number
    headers: Record<string, string>
  }
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
      // Process URL first to extract hostname for Host header
      let url = params.url
      // Strip any surrounding quotes
      if (typeof url === 'string') {
        if (
          (url.startsWith('"') && url.endsWith('"')) ||
          (url.startsWith("'") && url.endsWith("'"))
        ) {
          url = url.slice(1, -1)
          params.url = url
        }
      }

      // Extract hostname for Host header
      let hostname = ''
      try {
        hostname = new URL(url).host
      } catch (e) {
        // Invalid URL, will be caught later
      }
      
      // Prepare fetch options
      const userHeaders = transformTable(params.headers || null)
      const headers = { ...DEFAULT_HEADERS, ...userHeaders }
      
      // Add Host header if not explicitly set by user
      if (hostname && !userHeaders['Host'] && !userHeaders['host']) {
        headers['Host'] = hostname
      }
      
      // Set dynamic Referer if not explicitly provided by user
      if (!userHeaders['Referer'] && !userHeaders['referer']) {
        headers['Referer'] = getReferer()
      }
      
      const fetchOptions: RequestInit = {
        method: params.method || 'GET',
        headers
      }

      // Add body for non-GET requests
      if (params.method && params.method !== 'GET' && params.body) {
        if (typeof params.body === 'object') {
          fetchOptions.body = JSON.stringify(params.body)
          // Ensure Content-Type is set
          if (fetchOptions.headers) {
            (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json'
          } else {
            fetchOptions.headers = { 'Content-Type': 'application/json' }
          }
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
      const timeout = params.timeout || 50000
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      fetchOptions.signal = controller.signal

      try {
        // Process URL with path parameters and query params


        // Replace path parameters
        if (params.pathParams) {
          Object.entries(params.pathParams).forEach(([key, value]) => {
            url = url.replace(`:${key}`, encodeURIComponent(value))
          })
        }

        // Handle query parameters
        const queryParamsObj = transformTable(params.params || null)
        const queryString = Object.entries(queryParamsObj)
          .filter(([_, value]) => value !== undefined && value !== null)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          .join('&')

        if (queryString) {
          url += (url.includes('?') ? '&' : '?') + queryString
        }

        // Make the actual fetch request
        const response = await fetch(url, fetchOptions)
        clearTimeout(timeoutId)

        // Convert Headers to a plain object
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })

        // Parse response based on content type
        let data
        try {
          if (response.headers.get('content-type')?.includes('application/json')) {
            data = await response.json()
          } else {
            data = await response.text()
          }
        } catch (error) {
          data = await response.text()
        }

        return {
          success: response.ok,
          output: {
            data,
            status: response.status,
            headers,
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
      let url = params.url

      // Strip any surrounding quotes that might have been added during resolution
      if (typeof url === 'string') {
        if (
          (url.startsWith('"') && url.endsWith('"')) ||
          (url.startsWith("'") && url.endsWith("'"))
        ) {
          url = url.slice(1, -1)
          // Update the params with unquoted URL
          params.url = url
        }
      }

      // Replace path parameters
      if (params.pathParams) {
        Object.entries(params.pathParams).forEach(([key, value]) => {
          url = url.replace(`:${key}`, encodeURIComponent(value))
        })
      }

      // Handle query parameters
      const queryParamsObj = transformTable(params.params || null)
      const queryString = Object.entries(queryParamsObj)
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')

      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString
      }

      return url
    },
    method: 'POST' as HttpMethod,
    headers: (params: RequestParams) => {
      const headers = transformTable(params.headers || null)
      
      // Merge with default headers
      const allHeaders = { ...DEFAULT_HEADERS, ...headers }
      
      // Add dynamic Host header if not explicitly set
      try {
        const hostname = new URL(params.url).host
        if (hostname && !headers['Host'] && !headers['host']) {
          allHeaders['Host'] = hostname
        }
      } catch (e) {
        // Invalid URL, will be handled elsewhere
      }

      // Add dynamic Referer if not explicitly set
      if (!headers['Referer'] && !headers['referer']) {
        allHeaders['Referer'] = getReferer()
      }

      // Set appropriate Content-Type
      if (params.formData) {
        // Don't set Content-Type for FormData, browser will set it with boundary
        return allHeaders
      } else if (params.body) {
        allHeaders['Content-Type'] = 'application/json'
      }

      return allHeaders
    },
    body: (params: RequestParams) => {
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
    // Convert Headers to a plain object
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    // Parse response based on content type
    const data = await (response.headers.get('content-type')?.includes('application/json')
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
    const message = error.message || error.error?.message
    const code = error.status || error.error?.status
    const details = error.response?.data ? `\nDetails: ${JSON.stringify(error.response.data)}` : ''
    return `${message} (${code})${details}`
  },
}
