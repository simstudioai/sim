import { contextDevHosting } from '@/tools/context_dev/hosting'
import type {
  ContextDevClassifySicParams,
  ContextDevClassifySicResponse,
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

export const contextDevClassifySicTool: ToolConfig<
  ContextDevClassifySicParams,
  ContextDevClassifySicResponse
> = {
  id: 'context_dev_classify_sic',
  name: 'Context.dev Classify SIC',
  description: 'Classify a brand into SIC industry codes from its domain or company name.',
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevClassifySicParams>(),

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Brand domain or company name to classify (e.g., "stripe.com" or "Stripe")',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SIC taxonomy version: "original_sic" (default) or "latest_sec"',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/web/sic`)
      appendParam(url.searchParams, 'input', params.input)
      appendParam(url.searchParams, 'type', params.type)
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
        classification: data.classification ?? null,
        codes: data.codes ?? [],
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Classification status' },
    domain: { type: 'string', description: 'Resolved domain', optional: true },
    type: { type: 'string', description: 'Input type that was resolved', optional: true },
    classification: {
      type: 'string',
      description: 'SIC taxonomy version used (original_sic or latest_sec)',
      optional: true,
    },
    codes: {
      type: 'array',
      description: 'Matched SIC codes with name, confidence, and group metadata',
      items: {
        type: 'object',
        properties: {
          ...CLASSIFICATION_CODE_OUTPUT_PROPERTIES,
          majorGroup: { type: 'string', description: 'Major group code (original_sic only)' },
          majorGroupName: { type: 'string', description: 'Major group name (original_sic only)' },
          office: { type: 'string', description: 'SEC office (latest_sec only)' },
        },
      },
    },
    ...CREDIT_OUTPUTS,
  },
}
