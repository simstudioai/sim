import type { ToolConfig } from '@/tools/types'

export const stripeTAXTOOL: ToolConfig = {
  id: 'stripe_tax',
  name: 'Stripe Tax',
  description: 'Manage Stripe tax operations through the Stripe API.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key (sk_live_* or sk_test_*)',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Operation to perform',
    },
    resourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resource ID',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Expand nested resources',
    },
  },
  outputs: {
    result: {
      type: 'object',
      description: 'Operation result',
    },
    error: {
      type: 'string',
      description: 'Error message',
      optional: true,
    },
  },
  request: {
    url: () => 'https://api.stripe.com/v1/tax',
    method: () => 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },
}
