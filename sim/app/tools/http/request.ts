import { HttpMethod, TableRow, ToolConfig, ToolResponse } from '../types'
import { transformTable } from '../utils'

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

  request: {
    url: (params: RequestParams) => {
      let url = params.url

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
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&')

      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString
      }

      return url
    },
    method: 'POST' as HttpMethod,
    headers: (params: RequestParams) => {
      const headers = transformTable(params.headers || null)

      // Set appropriate Content-Type
      if (params.formData) {
        // Don't set Content-Type for FormData, browser will set it with boundary
        return headers
      } else if (params.body) {
        headers['Content-Type'] = 'application/json'
      }

      return headers
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
