import type {
  ContextDevBrandResponse,
  ContextDevIdentifyTransactionParams,
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

export const contextDevIdentifyTransactionTool: ToolConfig<
  ContextDevIdentifyTransactionParams,
  ContextDevBrandResponse
> = {
  id: 'context_dev_identify_transaction',
  name: 'Context.dev Identify Transaction',
  description:
    'Identify the brand behind a raw bank/card transaction descriptor and return its brand data.',
  version: '1.0.0',

  params: {
    transactionInfo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The raw transaction descriptor or identifier to resolve to a brand',
    },
    countryGl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 2-letter country code from the transaction (e.g., "us", "gb")',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City name to prioritize in the search',
    },
    mcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Merchant Category Code for the business category',
    },
    phone: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number from the transaction for verification',
    },
    highConfidenceOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enforce additional verification steps for higher confidence (default: false)',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/brand/transaction_identifier`)
      appendParam(url.searchParams, 'transaction_info', params.transactionInfo)
      appendParam(url.searchParams, 'country_gl', params.countryGl)
      appendParam(url.searchParams, 'city', params.city)
      appendParam(url.searchParams, 'mcc', params.mcc)
      appendParam(url.searchParams, 'phone', params.phone)
      appendParam(url.searchParams, 'high_confidence_only', params.highConfidenceOnly)
      appendParam(url.searchParams, 'force_language', params.forceLanguage)
      appendParam(url.searchParams, 'maxSpeed', params.maxSpeed)
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
    status: { type: 'string', description: 'Identification status' },
    brand: {
      type: 'object',
      description: 'Brand data for the identified merchant',
      properties: BRAND_OUTPUT_PROPERTIES,
    },
    ...CREDIT_OUTPUTS,
  },
}
