import type {
  ContextDevGetBrandParams,
  ContextDevGetBrandResponse,
} from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevGetBrandTool: ToolConfig<
  ContextDevGetBrandParams,
  ContextDevGetBrandResponse
> = {
  id: 'context_dev_get_brand',
  name: 'Context.dev Get Brand',
  description:
    'Retrieve brand data for a domain: logos, colors, backdrops, socials, address, and industry.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain to retrieve brand data for (e.g., "airbnb.com")',
    },
    forceLanguage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override the detected language with a supported language code',
    },
    maxSpeed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip time-consuming operations for a faster response (default: false)',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/brand/retrieve`)
      appendParam(url.searchParams, 'domain', params.domain)
      appendParam(url.searchParams, 'force_language', params.forceLanguage)
      appendParam(url.searchParams, 'maxSpeed', params.maxSpeed)
      appendParam(url.searchParams, 'maxAgeMs', params.maxAgeMs)
      appendParam(url.searchParams, 'timeoutMS', params.timeoutMS)
      return url.toString()
    },
    headers: (params) => contextDevHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    return {
      success: true,
      output: {
        status: data.status ?? '',
        brand: data.brand ?? null,
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Retrieval status' },
    brand: {
      type: 'object',
      description: 'Brand data object',
      properties: {
        domain: { type: 'string', description: 'Brand domain' },
        title: { type: 'string', description: 'Brand title' },
        description: { type: 'string', description: 'Brand description' },
        slogan: { type: 'string', description: 'Brand slogan' },
        colors: { type: 'json', description: 'Brand colors (hex and name)' },
        logos: { type: 'json', description: 'Brand logos with mode, colors, resolution, and type' },
        backdrops: { type: 'json', description: 'Brand backdrop images' },
        socials: { type: 'json', description: 'Social media profiles (type and url)' },
        address: { type: 'json', description: 'Brand address' },
        stock: { type: 'json', description: 'Stock info (ticker and exchange)' },
        is_nsfw: { type: 'boolean', description: 'Whether the brand contains adult content' },
        email: { type: 'string', description: 'Brand contact email' },
        phone: { type: 'string', description: 'Brand contact phone' },
        industries: { type: 'json', description: 'Industry taxonomy (eic pairs)' },
        links: { type: 'json', description: 'Key brand links (careers, privacy, terms, etc.)' },
        primary_language: { type: 'string', description: 'Primary language of the brand site' },
      },
    },
    ...CREDIT_OUTPUTS,
  },
}
