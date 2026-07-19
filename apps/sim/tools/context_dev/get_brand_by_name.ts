import { contextDevHosting } from '@/tools/context_dev/hosting'
import type {
  ContextDevBrandResponse,
  ContextDevGetBrandByNameParams,
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

export const contextDevGetBrandByNameTool: ToolConfig<
  ContextDevGetBrandByNameParams,
  ContextDevBrandResponse
> = {
  id: 'context_dev_get_brand_by_name',
  name: 'Context.dev Get Brand by Name',
  description:
    'Retrieve brand data by company name: logos, colors, socials, address, and industry.',
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevGetBrandByNameParams>(),

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company name to retrieve brand data for (3-30 chars, e.g., "Apple Inc")',
    },
    countryGl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 2-letter country code to prioritize (e.g., "us")',
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
      const url = new URL(`${CONTEXT_DEV_BASE_URL}/brand/retrieve-by-name`)
      appendParam(url.searchParams, 'name', params.name)
      appendParam(url.searchParams, 'country_gl', params.countryGl)
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
