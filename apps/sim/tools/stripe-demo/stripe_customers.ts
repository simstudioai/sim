
import type { ToolConfig } from '@/tools/types'

export const stripeCustomersTool: ToolConfig = {
  id: 'stripe_customers',
  name: 'Stripe Customers',
  description: 'Manage customers via Stripe API',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Stripe API key'
    }
  },
  outputs: {
    result: { type: 'object', description: 'API response' }
  },
  request: {
    url: () => 'https://api.stripe.com/v1/customers',
    method: () => 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.apiKey}`
    })
  }
}
