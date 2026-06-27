/**
 * Stripe Block Configuration
 */

import { BlockConfig, BlockMeta } from '@sim/workflow-types';

export const stripeBlock: BlockConfig = {
  type: 'stripe',
  name: 'Stripe',
  category: 'tools',
  integrationType: 'Payment',
  authMode: 'ApiKey',
  bgColor: '#635BFF',

  subBlocks: [
    {
      id: 'operation',
      type: 'dropdown',
      title: 'Operation',
      required: true,
      visibility: 'user-or-llm',
      mode: 'basic',
    },
    {
      id: 'apiKey',
      type: 'short-input',
      title: 'API Key',
      required: true,
      visibility: 'user-only',
      password: true,
      mode: 'basic',
    },
  ],

  tools: {
    access: [
      'stripe_create_customer',
      'stripe_list_customers',
      'stripe_create_charge',
    ],
    config: {
      tool: '${operation}',
      params: {
        apiKey: '${apiKey}',
      },
    },
  },
};

export const stripeBlockMeta: BlockMeta = {
  tags: ['Payment', 'Commerce', 'Billing'],
  templates: [
    {
      name: 'Create Customer on Signup',
      prompt: 'Build a workflow that creates a Stripe customer when someone signs up',
    },
    {
      name: 'Charge Card on Purchase',
      prompt: 'Create a workflow that charges a Stripe card when an order is placed',
    },
  ],
  skills: [
    { title: 'Create Customer', action: 'stripe_create_customer' },
    { title: 'List Customers', action: 'stripe_list_customers' },
    { title: 'Create Charge', action: 'stripe_create_charge' },
  ],
};
