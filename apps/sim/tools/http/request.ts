import type { RequestParams, RequestResponse } from '@/tools/http/types'
import { getDefaultHeaders, processUrl, shouldUseProxy, transformTable } from '@/tools/http/utils'
import type { ToolConfig } from '@/tools/types'

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

  request: {
    url: (params: RequestParams) => {
      // Process the URL first to handle path/query params
      const processedUrl = processUrl(params.url, params.pathParams, params.params)

      // For external URLs that need proxying in the browser, we still return the
      // external URL here and let executeTool route through the POST /api/proxy
      // endpoint uniformly. This avoids querystring body encoding and prevents
      // the proxy GET route from being hit from the client.
      if (shouldUseProxy(processedUrl)) {
        return processedUrl
      }

      return processedUrl
    },

    method: (params: RequestParams) => params.method || 'GET',

    headers: (params: RequestParams) => {
      const headers = transformTable(params.headers || null)
      const processedUrl = processUrl(params.url, params.pathParams, params.params)

      // For proxied requests, we only need minimal headers
      if (shouldUseProxy(processedUrl)) {
        return {
          'Content-Type': 'application/json',
        }
      }

      // For direct requests, add all our standard headers
      const allHeaders = getDefaultHeaders(headers, processedUrl)

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
      const processedUrl = processUrl(params.url, params.pathParams, params.params)

      // For proxied requests, we don't need a body
      if (shouldUseProxy(processedUrl)) {
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
    // Build headers once for consistent return structures
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const contentType = response.headers.get('content-type') || ''
    const isJson = contentType.includes('application/json')

    if (isJson) {
      // Use a clone to safely inspect JSON without consuming the original body
      let jsonResponse: any
      try {
        jsonResponse = await response.clone().json()
      } catch (_e) {
        jsonResponse = undefined
      }

      // Proxy responses wrap the real payload
      if (jsonResponse && jsonResponse.data !== undefined && jsonResponse.status !== undefined) {
        return {
          success: jsonResponse.success,
          output: {
            data: jsonResponse.data,
            status: jsonResponse.status,
            headers: jsonResponse.headers || {},
          },
          error: jsonResponse.success
            ? undefined
            : jsonResponse.data && typeof jsonResponse.data === 'object' && jsonResponse.data.error
              ? `HTTP error ${jsonResponse.status}: ${jsonResponse.data.error.message || JSON.stringify(jsonResponse.data.error)}`
              : jsonResponse.error || `HTTP error ${jsonResponse.status}`,
        }
      }

      // Non-proxy JSON response: return parsed JSON directly
      return {
        success: response.ok,
        output: {
          data: jsonResponse ?? (await response.text()),
          status: response.status,
          headers,
        },
        error: response.ok ? undefined : `HTTP error ${response.status}: ${response.statusText}`,
      }
    }

    // Non-JSON response: return text
    const textData = await response.text()
    return {
      success: response.ok,
      output: {
        data: textData,
        status: response.status,
        headers,
      },
      error: response.ok ? undefined : `HTTP error ${response.status}: ${response.statusText}`,
    }
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
}
