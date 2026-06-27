import { StripeIcon } from '@/components/icons-generated/stripe'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const StripeBlock: BlockConfig = {
  type: 'stripe',
  name: 'Stripe Payments & Billing',
  description: 'Process payments, manage subscriptions, and handle complex financial transactions globally.',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  bgColor: '#6366f1',
  icon: StripeIcon,
  authMode: AuthMode.ApiKey,

  triggerAllowed: true,
  triggers: {
    enabled: true,
    available: ['stripe_webhook'],
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create a Payment Charge', id: 'stripe_create_charge' },
        { label: 'Retrieve Customer Details', id: 'stripe_retrieve_customer' },
        { label: 'Create Checkout Session Link', id: 'stripe_create_checkout_session' },
        { label: 'List Available Products', id: 'stripe_list_products' },
        { label: 'Create Recurring Subscription', id: 'stripe_create_subscription' },
        { label: 'Listen for Webhook Events (Conceptual)', id: 'stripe_webhook_listen' },
      ],
      value: () => 'stripe_create_charge',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your api key',
    },
  ],

  tools: {
    access: ['stripe_create_charge', 'stripe_create_checkout_session', 'stripe_create_subscription', 'stripe_list_products', 'stripe_retrieve_customer', 'stripe_webhook_listen'],
    config: {
      tool: (params: Record<string, any>) => params.operation,
      params: (params: Record<string, any>) => ({
        apiKey: (params as any).apiKey ?? '',
      }),
    },
  },

  inputs: {},
  outputs: {},
}

export const StripeBlockMeta: BlockMeta = {
  displayName: 'Stripe Payments & Billing',
  description: 'Process payments, manage subscriptions, and handle complex financial transactions globally.',
  category: 'tools',
  icon: StripeIcon,
  tags: ['Payments', 'E-commerce', 'Integration'],
  templates: [
    { name: 'Process One-Time Payment', prompt: 'Build a workflow that takes an amount, currency, and payment source token to create a charge via Stripe.' },
    { name: 'Manage Customer Details', prompt: 'Create a process to retrieve or update customer information using their unique Stripe ID.' },
    { name: 'Set Up Subscription Billing', prompt: 'Design a workflow to create a recurring subscription for a customer based on a specific price plan.' },
  ],
  skills: [
    { title: 'Stripe Operation', action: 'stripe_create_charge' },
  ],
}
