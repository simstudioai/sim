import type { ToolConfig } from '@/tools/types'

export const stripeListProductsTool: ToolConfig = {
  id: 'stripe_list_products',
  name: 'List Available Products',
  description:
    'Retrieves a list of all products defined in the Stripe dashboard. Used for catalog management.',
  version: '1.0.0',

  params: {
    limit: {
      type: 'string',
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return per page.',
    },
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Array containing Product objects.',
    },
    has_more: {
      type: 'string',
      description: 'Indicates if there are more results available.',
      optional: true,
    },
  },

  request: {
    url: () => `https://api.stripe.com/v1/products`,
    method: () => 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      data: data.data ?? null,
      has_more: data.has_more ?? false,
    }
  },
}
