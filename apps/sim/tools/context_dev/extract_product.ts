import { contextDevHosting } from '@/tools/context_dev/hosting'
import type {
  ContextDevExtractProductParams,
  ContextDevExtractProductResponse,
} from '@/tools/context_dev/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/context_dev/types'
import {
  CONTEXT_DEV_BASE_URL,
  CREDIT_OUTPUTS,
  contextDevJsonHeaders,
  extractCreditMetadata,
  parseContextDevResponse,
} from '@/tools/context_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const contextDevExtractProductTool: ToolConfig<
  ContextDevExtractProductParams,
  ContextDevExtractProductResponse
> = {
  id: 'context_dev_extract_product',
  name: 'Context.dev Extract Product',
  description: 'Detect and extract structured product details from a single product page URL.',
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevExtractProductParams>(),

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The product page URL (must include http:// or https://)',
    },
    maxAgeMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cache duration in milliseconds (0-2592000000, default: 604800000)',
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
    method: 'POST',
    url: () => `${CONTEXT_DEV_BASE_URL}/brand/ai/product`,
    headers: (params) => contextDevJsonHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, any> = { url: params.url }
      if (params.maxAgeMs != null) body.maxAgeMs = params.maxAgeMs
      if (params.timeoutMS != null) body.timeoutMS = params.timeoutMS
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseContextDevResponse(response)
    return {
      success: true,
      output: {
        isProductPage: data.is_product_page ?? false,
        platform: data.platform ?? null,
        product: data.product ?? null,
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    isProductPage: { type: 'boolean', description: 'Whether the URL is a product page' },
    platform: {
      type: 'string',
      description: 'Detected platform (amazon, tiktok_shop, etsy, generic)',
      optional: true,
    },
    product: {
      type: 'object',
      description: 'Extracted product details',
      properties: PRODUCT_OUTPUT_PROPERTIES,
    },
    ...CREDIT_OUTPUTS,
  },
}
