import { contextDevHosting } from '@/tools/context_dev/hosting'
import type { ContextDevMapParams, ContextDevMapResponse } from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevMapTool: ToolConfig<ContextDevMapParams, ContextDevMapResponse> = {
  id: 'context_dev_map',
  name: 'Context.dev Map',
  description: 'Build a sitemap of a domain and return every discovered page URL.',
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevMapParams>(),

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain to build a sitemap for (e.g., "example.com")',
    },
    maxLinks: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of URLs to return (1-100000, default: 10000)',
    },
    urlRegex: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'RE2-compatible regex to filter URLs (max 256 chars)',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/scrape/sitemap`)
      appendParam(url.searchParams, 'domain', params.domain)
      appendParam(url.searchParams, 'maxLinks', params.maxLinks)
      appendParam(url.searchParams, 'urlRegex', params.urlRegex)
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
        domain: data.domain ?? '',
        urls: data.urls ?? [],
        meta: data.meta ?? {},
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    domain: { type: 'string', description: 'The domain that was mapped' },
    urls: {
      type: 'array',
      description: 'All page URLs discovered from the sitemap',
      items: { type: 'string', description: 'Page URL' },
    },
    meta: {
      type: 'object',
      description:
        'Sitemap discovery stats (sitemapsDiscovered, sitemapsFetched, sitemapsSkipped, errors)',
    },
    ...CREDIT_OUTPUTS,
  },
}
