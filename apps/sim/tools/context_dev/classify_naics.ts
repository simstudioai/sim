import type {
  ContextDevClassifyNaicsParams,
  ContextDevClassifyNaicsResponse,
} from '@/tools/context_dev/types'
import { CLASSIFICATION_CODE_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  appendParam,
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevClassifyNaicsTool: ToolConfig<
  ContextDevClassifyNaicsParams,
  ContextDevClassifyNaicsResponse
> = {
  id: 'context_dev_classify_naics',
  name: 'Context.dev Classify NAICS',
  description: 'Classify a brand into NAICS industry codes from its domain or company name.',
  version: '1.0.0',

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Brand domain or company name to classify (e.g., "stripe.com" or "Stripe")',
    },
    minResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum number of codes to return (1-10, default: 1)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of codes to return (1-10, default: 5)',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/naics`)
      appendParam(url.searchParams, 'input', params.input)
      appendParam(url.searchParams, 'minResults', params.minResults)
      appendParam(url.searchParams, 'maxResults', params.maxResults)
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
        domain: data.domain ?? null,
        type: data.type ?? null,
        codes: data.codes ?? [],
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Classification status' },
    domain: { type: 'string', description: 'Resolved domain', optional: true },
    type: { type: 'string', description: 'Input type that was resolved', optional: true },
    codes: {
      type: 'array',
      description: 'Matched NAICS codes with name and confidence',
      items: { type: 'object', properties: CLASSIFICATION_CODE_OUTPUT_PROPERTIES },
    },
    ...CREDIT_OUTPUTS,
  },
}
