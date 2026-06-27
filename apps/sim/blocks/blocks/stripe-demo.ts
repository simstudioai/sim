
import type { BlockConfig } from '@/blocks/types'

export const StripeBlock: BlockConfig = {
  id: 'stripe',
  integrationType: 'stripe',
  name: 'Stripe',
  description: 'Stripe payments integration',
  category: 'tools',
  tags: ['payments', 'billing'],
  authMode: 'credentials',
  docsLink: 'https://stripe.com/docs/api',
  brandColor: '#635BFF',
  subBlocks: [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      visibility: 'user-only',
      password: true,
      description: 'Stripe API key'
    }
  ]
}
