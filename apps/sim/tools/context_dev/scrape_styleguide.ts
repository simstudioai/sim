import type {
  ContextDevScrapeStyleguideParams,
  ContextDevScrapeStyleguideResponse,
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

export const contextDevScrapeStyleguideTool: ToolConfig<
  ContextDevScrapeStyleguideParams,
  ContextDevScrapeStyleguideResponse
> = {
  id: 'context_dev_scrape_styleguide',
  name: 'Context.dev Scrape Styleguide',
  description:
    "Extract a domain's design system: colors, typography, spacing, shadows, and UI components.",
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain to extract the styleguide from (e.g., "example.com")',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/styleguide`)
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
        styleguide: data.styleguide ?? null,
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Extraction status' },
    domain: { type: 'string', description: 'The domain that was analyzed' },
    styleguide: {
      type: 'json',
      description:
        'Design system: mode, colors, typography, elementSpacing, shadows, fontLinks, components',
    },
    ...CREDIT_OUTPUTS,
  },
}
