import { isReadRequest } from '@/lib/core/utils/http-methods'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type { RequestParams, RequestResponse } from '@/tools/http/types'
import {
  getCredentialHeaderNames,
  getDefaultHeaders,
  processUrl,
  toHttpToolResponse,
} from '@/tools/http/utils'
import { transformTable } from '@/tools/shared/table'
import type { ToolConfig } from '@/tools/types'

const MAX_HTTP_RESPONSE_BODY_BYTES = 10 * 1024 * 1024

export const requestTool: ToolConfig<RequestParams, RequestResponse> = {
  id: 'http_request',
  name: 'HTTP Request',
  description:
    'Make HTTP requests with comprehensive support for methods, headers, query parameters, path parameters, and form data. Features configurable timeout and status validation for robust API interactions.',
  version: '1.0.0',
  effect: 'write',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to send the request to',
    },
    method: {
      type: 'string',
      default: 'GET',
      visibility: 'user-or-llm',
      description: 'HTTP method (GET, POST, PUT, PATCH, DELETE)',
    },
    headers: {
      type: 'object',
      visibility: 'user-or-llm',
      description: 'HTTP headers to include',
    },
    body: {
      type: 'object',
      visibility: 'user-or-llm',
      description: 'Request body (for POST, PUT, PATCH)',
    },
    params: {
      type: 'object',
      visibility: 'user-or-llm',
      description: 'URL query parameters to append',
    },
    pathParams: {
      type: 'object',
      visibility: 'user-or-llm',
      description: 'URL path parameters to replace (e.g., :id in /users/:id)',
    },
    formData: {
      type: 'object',
      visibility: 'user-or-llm',
      description: 'Form data to send (will set appropriate Content-Type)',
    },
    proxyUrl: {
      type: 'string',
      visibility: 'user-only',
      description: 'Route the request through an http:// proxy (e.g. http://user:pass@host:port).',
    },
    timeout: {
      type: 'number',
      visibility: 'user-only',
      description: 'Request timeout in milliseconds (default: 300000 = 5 minutes)',
    },
    retries: {
      type: 'number',
      visibility: 'hidden',
      description:
        'Times to resend the request (default: 0, max: 10), only after a timeout, a connection reset, a 429 or a 5xx response, and only for GET, HEAD, PUT and DELETE unless retryNonIdempotent is true. A host that does not resolve or refuses the connection, and any other 4xx, fail at once.',
    },
    retryDelayMs: {
      type: 'number',
      visibility: 'hidden',
      description:
        'Wait before the first retry in milliseconds (default: 500); it doubles each retry, with jitter, up to retryMaxDelayMs.',
    },
    retryMaxDelayMs: {
      type: 'number',
      visibility: 'hidden',
      description:
        'Longest wait between retries in milliseconds (default: 30000). A Retry-After header asking for longer ends the retries.',
    },
    retryNonIdempotent: {
      type: 'boolean',
      visibility: 'hidden',
      description:
        'Also retry POST, PATCH and other non-idempotent methods (may create duplicate requests).',
    },
    redirectPolicyVersion: {
      type: 'string',
      visibility: 'hidden',
      description: 'Persisted redirect-policy compatibility version.',
    },
    sendCredentialsOnCrossOriginRedirect: {
      type: 'boolean',
      visibility: 'user-only',
      description:
        'Send credential-bearing headers when a redirect targets a different origin. Enabled by default for compatibility.',
    },
  },

  readsWhen: (params) => {
    const method: unknown = params.method || 'GET'
    if (typeof method !== 'string') return false
    try {
      return isReadRequest(method, Object.keys(transformTable(params.headers || null)))
    } catch {
      return false
    }
  },

  timeoutParamIsDeadline: true,

  request: {
    allowSameOrigin: true,
    url: (params: RequestParams) => {
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

      // Set appropriate Content-Type only if not already specified by user
      if (params.formData) {
        // Don't set Content-Type for FormData, browser will set it with boundary
        return allHeaders
      }
      if (params.body && !allHeaders['Content-Type'] && !allHeaders['content-type']) {
        allHeaders['Content-Type'] = 'application/json'
      }

      return allHeaders
    },

    body: ((params: RequestParams) => {
      if (params.formData) {
        const formData = new FormData()
        Object.entries(params.formData).forEach(([key, value]) => {
          formData.append(key, value)
        })
        return formData
      }

      if (params.body) {
        const headers = transformTable(params.headers || null)
        const contentType = headers['Content-Type'] || headers['content-type']

        if (
          contentType === 'application/x-www-form-urlencoded' &&
          typeof params.body === 'object'
        ) {
          // Convert JSON object to URL-encoded string
          const urlencoded = new URLSearchParams()
          Object.entries(params.body as Record<string, unknown>).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              urlencoded.append(
                key,
                typeof value === 'object' ? JSON.stringify(value) : String(value)
              )
            }
          })
          return urlencoded.toString()
        }

        return params.body as Record<string, any>
      }

      return undefined
    }) as (params: RequestParams) => Record<string, any> | string | FormData | undefined,

    retry: {
      enabled: true,
      maxRetries: 0,
      initialDelayMs: 500,
      maxDelayMs: 30000,
      retryIdempotentOnly: true,
    },
    redirectPolicy: (params: RequestParams) => {
      return {
        mode: params.redirectPolicyVersion === 'standard-v1' ? 'standard' : 'legacy',
        sendCredentialsOnCrossOriginRedirect: params.sendCredentialsOnCrossOriginRedirect !== false,
        sensitiveHeaders: getCredentialHeaderNames(params.headers),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const contentType = response.headers.get('content-type') || ''

    const responseText = await readResponseTextWithLimit(response, {
      maxBytes: MAX_HTTP_RESPONSE_BODY_BYTES,
      label: 'HTTP Request response body',
      allowNoBodyFallback: true,
    })
    const data = contentType.includes('application/json') ? JSON.parse(responseText) : responseText

    return toHttpToolResponse(response, data)
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
