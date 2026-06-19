import type {
  ContextDevBrandResponse,
  ContextDevGetBrandByTickerParams,
} from '@/tools/context_dev/types'
import { BRAND_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  parseContextDevResponse,
  transformBrandResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevGetBrandByTickerTool: ToolConfig<
  ContextDevGetBrandByTickerParams,
  ContextDevBrandResponse
> = {
  id: 'context_dev_get_brand_by_ticker',
  name: 'Context.dev Get Brand by Ticker',
  description: 'Retrieve brand data for a public company by its stock ticker symbol.',
  version: '1.0.0',

  params: {
    ticker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stock ticker symbol (e.g., "AAPL", "GOOGL", "BRK.A")',
    },
    tickerExchange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exchange code for the ticker (e.g., "NASDAQ", "NYSE", "LSE"). Default: NASDAQ',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/brand/retrieve-by-ticker`)
      appendParam(url.searchParams, 'ticker', params.ticker)
      appendParam(url.searchParams, 'ticker_exchange', params.tickerExchange)
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
    return { success: true, output: transformBrandResponse(data) }
  },

  outputs: {
    status: { type: 'string', description: 'Retrieval status' },
    brand: {
      type: 'object',
      description: 'Brand data object',
      properties: BRAND_OUTPUT_PROPERTIES,
    },
    ...CREDIT_OUTPUTS,
  },
}
