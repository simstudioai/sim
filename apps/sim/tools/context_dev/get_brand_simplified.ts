import type {
  ContextDevGetBrandSimplifiedParams,
  ContextDevGetBrandSimplifiedResponse,
} from '@/tools/context_dev/types'
import { SIMPLIFIED_BRAND_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  parseContextDevResponse,
  transformBrandResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevGetBrandSimplifiedTool: ToolConfig<
  ContextDevGetBrandSimplifiedParams,
  ContextDevGetBrandSimplifiedResponse
> = {
  id: 'context_dev_get_brand_simplified',
  name: 'Context.dev Get Brand (Simplified)',
  description: 'Retrieve essential brand data for a domain: title, colors, logos, and backdrops.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain to retrieve simplified brand data for (e.g., "airbnb.com")',
    },
    maxAgeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cache max age in milliseconds (86400000-31536000000, default: 7776000000)',
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
    method: 'GET',
    url: (params) => {
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/brand/retrieve-simplified`)
      appendParam(url.searchParams, 'domain', params.domain)
      appendParam(url.searchParams, 'maxAgeMs', params.maxAgeMs)
      appendParam(url.searchParams, 'timeoutMS', params.timeoutMS)
      return url.toString()
    },
    headers: (params) => contextDevHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    return { success: true, output: transformBrandResponse(data) }
  },

  outputs: {
    status: { type: 'string', description: 'Retrieval status' },
    brand: {
      type: 'object',
      description: 'Simplified brand data (domain, title, colors, logos, backdrops)',
      properties: SIMPLIFIED_BRAND_OUTPUT_PROPERTIES,
    },
    ...CREDIT_OUTPUTS,
  },
}
