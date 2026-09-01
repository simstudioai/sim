import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import type { ModalCallFunctionParams, ModalCallFunctionResponse } from '@/tools/modal/types'
import {
  appendModalQueryParams,
  extractModalError,
  MAX_MODAL_RESPONSE_BODY_BYTES,
  modalProxyAuthHeaders,
  modalWebFunctionUrl,
} from '@/tools/modal/utils'
import { transformTable } from '@/tools/shared/table'
import type { HttpMethod, ToolConfig } from '@/tools/types'

/** Methods Modal's proxy forwards without a request body. */
const BODYLESS_METHODS = new Set<HttpMethod>(['GET', 'HEAD'])

function resolveMethod(params: ModalCallFunctionParams): HttpMethod {
  const method = params.method?.toString().trim().toUpperCase()
  return (method || 'POST') as HttpMethod
}

/**
 * Parses a body the function labelled `application/json`. A Web Function runs
 * arbitrary user code, so a mislabelled body is its bug to see — surfacing the
 * raw text beats failing the whole call with a bare `SyntaxError`.
 */
function parseJsonBody(text: string): unknown {
  if (!text) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const modalCallFunctionTool: ToolConfig<ModalCallFunctionParams, ModalCallFunctionResponse> =
  {
    id: 'modal_call_function',
    name: 'Modal Call Function',
    description: 'Invoke a deployed Modal Web Function or Server over HTTPS',
    version: '1.0.0',

    params: {
      url: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Public URL of the deployed Modal Web Function or Server (e.g., https://your-workspace--your-app-your-function.modal.run)',
      },
      method: {
        type: 'string',
        required: false,
        default: 'POST',
        visibility: 'user-or-llm',
        description: 'HTTP method to use: GET, POST, PUT, PATCH, DELETE, or HEAD',
      },
      body: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'JSON request body sent to the function',
      },
      queryParams: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Query parameters to append to the URL as key-value pairs',
      },
      headers: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Additional request headers as key-value pairs',
      },
      tokenId: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Modal proxy token ID (wk-...), required for authenticated functions',
      },
      tokenSecret: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'Modal proxy token secret (ws-...), required for authenticated functions',
      },
    },

    request: {
      url: (params) =>
        appendModalQueryParams(
          modalWebFunctionUrl(params.url),
          transformTable(params.queryParams ?? null)
        ),
      method: (params) => resolveMethod(params),
      headers: (params) => {
        const headers: Record<string, string> = {
          Accept: '*/*',
          ...transformTable(params.headers ?? null),
          ...modalProxyAuthHeaders(params),
        }

        const hasBody = params.body !== undefined && !BODYLESS_METHODS.has(resolveMethod(params))
        if (hasBody && !headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json'
        }

        return headers
      },
      body: (params) => {
        if (params.body === undefined || BODYLESS_METHODS.has(resolveMethod(params)))
          return undefined
        if (typeof params.body === 'string') return params.body
        return params.body as Record<string, unknown>
      },
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        throw new Error(await extractModalError(response, 'Modal function call failed'))
      }

      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })

      const text = await readResponseTextWithLimit(response, {
        maxBytes: MAX_MODAL_RESPONSE_BODY_BYTES,
        label: 'Modal function response body',
        allowNoBodyFallback: true,
      })
      const isJson = (response.headers.get('content-type') ?? '').includes('application/json')

      return {
        success: true,
        output: {
          data: isJson ? parseJsonBody(text) : text,
          status: response.status,
          headers,
        },
      }
    },

    outputs: {
      data: {
        type: 'json',
        description:
          'Body returned by the function — parsed JSON when it responds with application/json, otherwise the raw text',
      },
      status: { type: 'number', description: 'HTTP status code of the response' },
      headers: { type: 'json', description: 'Response headers as key-value pairs' },
    },
  }
