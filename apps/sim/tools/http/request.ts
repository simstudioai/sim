import type { RequestParams, RequestResponse } from '@/tools/http/types'
import { getDefaultHeaders, processUrl, shouldUseProxy, transformTable } from '@/tools/http/utils'
import type { HttpMethod, ToolConfig } from '@/tools/types'

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

  outputs: {
    data: {
      type: 'json',
      description: 'Response data from the HTTP request (JSON object, text, or other format)',
    },
    status: {
      type: 'number',
      description: 'HTTP status code of the response (e.g., 200, 404, 500)',
    },
    headers: {
      type: 'object',
      description: 'Response headers as key-value pairs',
      properties: {
        'content-type': {
          type: 'string',
          description: 'Content type of the response',
          optional: true,
        },
        'content-length': { type: 'string', description: 'Content length', optional: true },
      },
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
}
