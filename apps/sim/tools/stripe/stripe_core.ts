import type { ToolConfig } from '@/tools/types'

export const stripeCORETOOL: ToolConfig = {
  id: 'stripe_core',
  name: 'Stripe Core Account',
  description: 'Manage Stripe core account operations through the Stripe API.',
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
    url: () => 'https://api.stripe.com/v1/core',
    method: () => 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },
}
