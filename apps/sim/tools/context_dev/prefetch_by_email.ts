import type {
  ContextDevPrefetchByEmailParams,
  ContextDevPrefetchResponse,
} from '@/tools/context_dev/types'
import {
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevJsonHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevPrefetchByEmailTool: ToolConfig<
  ContextDevPrefetchByEmailParams,
  ContextDevPrefetchResponse
> = {
  id: 'context_dev_prefetch_by_email',
  name: 'Context.dev Prefetch by Email',
  description:
    "Queue an email's domain for brand-data prefetching to reduce later latency (subscribers; 0 credits). Free/disposable emails are rejected.",
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Work email address whose domain should be prefetched (free providers rejected)',
    },
    timeoutMS: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request timeout in milliseconds (1000-300000)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Context.dev API key',
    },
  },

  request: {
    method: 'POST',
    url: () => `${CONTEXT_DEV_BASE_URL}/brand/prefetch-by-email`,
    headers: (params) => contextDevJsonHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, any> = { email: params.email }
      if (params.timeoutMS != null) body.timeoutMS = params.timeoutMS
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    return {
      success: true,
      output: {
        status: data.status ?? '',
        message: data.message ?? '',
        domain: data.domain ?? '',
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Prefetch status' },
    message: { type: 'string', description: 'Human-readable prefetch result message' },
    domain: { type: 'string', description: 'The domain queued for prefetching' },
    ...CREDIT_OUTPUTS,
  },
}
