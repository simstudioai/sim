import { contextDevHosting } from '@/tools/context_dev/hosting'
import type {
  ContextDevExtractProductsParams,
  ContextDevExtractProductsResponse,
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

export const contextDevExtractProductsTool: ToolConfig<
  ContextDevExtractProductsParams,
  ContextDevExtractProductsResponse
> = {
  id: 'context_dev_extract_products',
  name: 'Context.dev Extract Products',
  description: "Extract the product catalog from a brand's website by domain (beta).",
  version: '1.0.0',

  hosting: contextDevHosting<ContextDevExtractProductsParams>(),

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The domain to extract products from (e.g., "example.com")',
    },
    maxProducts: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of products to extract (1-12)',
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
    url: () => `${CONTEXT_DEV_BASE_URL}/brand/ai/products`,
    headers: (params) => contextDevJsonHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, any> = { domain: params.domain }
      if (params.maxProducts != null) body.maxProducts = params.maxProducts
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
        products: data.products ?? [],
        ...extractCreditMetadata(data.key_metadata),
      },
    }
  },

  outputs: {
    products: {
      type: 'array',
      description: 'Extracted products with pricing, features, and metadata',
      items: { type: 'object', properties: PRODUCT_OUTPUT_PROPERTIES },
    },
    ...CREDIT_OUTPUTS,
  },
}
