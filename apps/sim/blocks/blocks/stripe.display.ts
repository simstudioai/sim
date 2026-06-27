import { StripeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const StripeBlockDisplay = {
  type: 'stripe',
  name: 'Stripe',
  description: 'Process payments and manage Stripe data',
  category: 'tools',
  bgColor: '#635BFF',
  icon: StripeIcon,
  iconColor: '#635BFF',
  longDescription:
    'Integrates Stripe into the workflow. Manage payment intents, customers, subscriptions, invoices, charges, products, prices, and events. Can be used in trigger mode to trigger a workflow when a Stripe event occurs.',
  docsLink: 'https://docs.sim.ai/integrations/stripe',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay
