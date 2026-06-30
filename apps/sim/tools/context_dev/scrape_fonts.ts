import type {
  ContextDevScrapeFontsParams,
  ContextDevScrapeFontsResponse,
} from '@/tools/context_dev/types'
import { FONT_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevScrapeFontsTool: ToolConfig<
  ContextDevScrapeFontsParams,
  ContextDevScrapeFontsResponse
> = {
  id: 'context_dev_scrape_fonts',
  name: 'Context.dev Scrape Fonts',
  description: 'Extract the font families, usage stats, and font files used by a domain.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain to extract fonts from (e.g., "example.com")',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/fonts`)
      appendParam(url.searchParams, 'domain', params.domain)
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
        domain: data.domain ?? '',
        fonts: data.fonts ?? [],
        fontLinks: data.fontLinks ?? {},
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Extraction status' },
    domain: { type: 'string', description: 'The domain that was analyzed' },
    fonts: {
      type: 'array',
      description: 'Fonts with usage statistics and fallbacks',
      items: { type: 'object', properties: FONT_OUTPUT_PROPERTIES },
    },
    fontLinks: {
      type: 'json',
      description: 'Font family download links keyed by font name (type, files, category)',
    },
    ...CREDIT_OUTPUTS,
  },
}
