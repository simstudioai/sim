import type { TriggerConfig } from '@/triggers/types'

export const stripeWebhookTrigger: TriggerConfig = {
  id: 'stripe_webhook',
  name: 'Stripe Webhook Listener Webhook',
  provider: 'stripe',
  description:
    'Triggers whenever a specified event occurs within your Stripe account (e.g., successful payment, customer creation).',
  version: '1.0.0',

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'eventTypes',
      title: 'Event Types',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { label: 'Payment Intent Succeeded', id: 'payment_intent.succeeded' },
        { label: 'Charge Failed', id: 'charge.failed' },
        { label: 'Customer Created', id: 'customer.created' },
        { label: 'Invoice Paid', id: 'invoice.paid' },
        { label: 'Account Updated', id: 'account.updated' },
      ],
      placeholder: 'Select events to listen for',
      description: 'Choose which events trigger this webhook.',
      mode: 'trigger',
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Signing Secret',
      type: 'short-input',
      placeholder: 'Your webhook secret',
      description: 'Used to verify webhook authenticity.',
      password: true,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        '<div class="mb-3"><strong>1.</strong> In your Stripe Dashboard, navigate to Webhooks.</div>',
        "<div class=\"mb-3\"><strong>2.</strong> Click 'Add Endpoint' and paste your system's webhook URL.</div>",
        '<div class="mb-3"><strong>3.</strong> Select the required events (e.g., payment_intent.succeeded) to ensure reliable triggering.</div>',
      ].join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
    event_type: {
      type: 'string',
      description: 'The type of event that occurred (e.g., payment_intent.succeeded).',
    },
    event_id: {
      type: 'string',
      description: 'The unique ID associated with the specific event instance.',
    },
    data: {
      type: 'json',
      description:
        'The full object data payload related to the event (e.g., the PaymentIntent object).',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
