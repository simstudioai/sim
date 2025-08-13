import type { RequestParams, RequestResponse } from '@/tools/http/types'
import { getDefaultHeaders, processUrl, transformTable } from '@/tools/http/utils'
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
      // Process the URL once and cache the result
      return processUrl(params.url, params.pathParams, params.params)
    },

    method: (params: RequestParams) => {
      // Always return the user's intended method - executeTool handles proxy routing
      return params.method || 'GET'
    },

    headers: (params: RequestParams) => {
      const headers = transformTable(params.headers || null)
      const processedUrl = processUrl(params.url, params.pathParams, params.params)
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
    const contentType = response.headers.get('content-type') || ''

    // Standard response handling
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    const data = await (contentType.includes('application/json')
      ? response.json()
      : response.text())

    // Check if this is a proxy response (structured response from /api/proxy)
    if (
      contentType.includes('application/json') &&
      typeof data === 'object' &&
      data !== null &&
      data.data !== undefined &&
      data.status !== undefined
    ) {
      return {
        success: data.success,
        output: {
          data: data.data,
          status: data.status,
          headers: data.headers || {},
        },
        error: data.success ? undefined : data.error,
      }
    }

    // Direct response handling
    return {
      success: response.ok,
      output: {
        data,
        status: response.status,
        headers,
      },
      error: undefined, // Errors are handled upstream in executeTool
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
