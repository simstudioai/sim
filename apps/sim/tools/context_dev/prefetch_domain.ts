import { contextDevHosting } from '@/tools/context_dev/hosting'
import type {
  ContextDevPrefetchDomainParams,
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

export const contextDevPrefetchDomainTool: ToolConfig<
  ContextDevPrefetchDomainParams,
  ContextDevPrefetchResponse
> = {
  id: 'context_dev_prefetch_domain',
  name: 'Context.dev Prefetch Domain',
  description:
    'Queue a domain for brand-data prefetching to reduce latency on later requests (subscribers; 0 credits).',
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevPrefetchDomainParams>(),

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain to prefetch brand data for (e.g., "example.com")',
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
    url: () => `${CONTEXT_DEV_BASE_URL}/brand/prefetch`,
    headers: (params) => contextDevJsonHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, any> = { domain: params.domain }
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
