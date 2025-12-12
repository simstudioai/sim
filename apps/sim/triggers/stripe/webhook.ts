import { StripeIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const stripeWebhookTrigger: TriggerConfig = {
  id: 'stripe_webhook',
  name: 'Stripe Webhook',
  provider: 'stripe',
  description: 'Triggers when Stripe events occur (payments, subscriptions, invoices, etc.)',
  version: '1.0.0',
  icon: StripeIcon,

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
      title: 'Event Types to Listen For',
      type: 'dropdown',
      multiSelect: true,
      options: [
        // Payment Intents
        { label: 'payment_intent.succeeded', id: 'payment_intent.succeeded' },
        { label: 'payment_intent.created', id: 'payment_intent.created' },
        { label: 'payment_intent.payment_failed', id: 'payment_intent.payment_failed' },
        { label: 'payment_intent.canceled', id: 'payment_intent.canceled' },
        {
          label: 'payment_intent.amount_capturable_updated',
          id: 'payment_intent.amount_capturable_updated',
        },
        { label: 'payment_intent.processing', id: 'payment_intent.processing' },
        { label: 'payment_intent.requires_action', id: 'payment_intent.requires_action' },

        // Charges
        { label: 'charge.succeeded', id: 'charge.succeeded' },
        { label: 'charge.failed', id: 'charge.failed' },
        { label: 'charge.captured', id: 'charge.captured' },
        { label: 'charge.refunded', id: 'charge.refunded' },
        { label: 'charge.updated', id: 'charge.updated' },
        { label: 'charge.dispute.created', id: 'charge.dispute.created' },
        { label: 'charge.dispute.closed', id: 'charge.dispute.closed' },
        { label: 'charge.expired', id: 'charge.expired' },
        { label: 'charge.dispute.funds_withdrawn', id: 'charge.dispute.funds_withdrawn' },
        { label: 'charge.dispute.funds_reinstated', id: 'charge.dispute.funds_reinstated' },

        // Customers
        { label: 'customer.created', id: 'customer.created' },
        { label: 'customer.updated', id: 'customer.updated' },
        { label: 'customer.deleted', id: 'customer.deleted' },
        { label: 'customer.source.created', id: 'customer.source.created' },
        { label: 'customer.source.updated', id: 'customer.source.updated' },
        { label: 'customer.source.deleted', id: 'customer.source.deleted' },
        { label: 'customer.subscription.created', id: 'customer.subscription.created' },
        { label: 'customer.subscription.updated', id: 'customer.subscription.updated' },
        { label: 'customer.subscription.deleted', id: 'customer.subscription.deleted' },
        { label: 'customer.discount.created', id: 'customer.discount.created' },
        { label: 'customer.discount.deleted', id: 'customer.discount.deleted' },
        { label: 'customer.discount.updated', id: 'customer.discount.updated' },

        // Subscriptions
        {
          label: 'customer.subscription.trial_will_end',
          id: 'customer.subscription.trial_will_end',
        },
        { label: 'customer.subscription.paused', id: 'customer.subscription.paused' },
        { label: 'customer.subscription.resumed', id: 'customer.subscription.resumed' },

        // Invoices
        { label: 'invoice.created', id: 'invoice.created' },
        { label: 'invoice.finalized', id: 'invoice.finalized' },
        { label: 'invoice.finalization_failed', id: 'invoice.finalization_failed' },
        { label: 'invoice.paid', id: 'invoice.paid' },
        { label: 'invoice.payment_failed', id: 'invoice.payment_failed' },
        { label: 'invoice.payment_succeeded', id: 'invoice.payment_succeeded' },
        { label: 'invoice.payment_action_required', id: 'invoice.payment_action_required' },
        { label: 'invoice.sent', id: 'invoice.sent' },
        { label: 'invoice.upcoming', id: 'invoice.upcoming' },
        { label: 'invoice.updated', id: 'invoice.updated' },
        { label: 'invoice.voided', id: 'invoice.voided' },
        { label: 'invoice.marked_uncollectible', id: 'invoice.marked_uncollectible' },
        { label: 'invoice.overdue', id: 'invoice.overdue' },

        // Products & Prices
        { label: 'product.created', id: 'product.created' },
        { label: 'product.updated', id: 'product.updated' },
        { label: 'product.deleted', id: 'product.deleted' },
        { label: 'price.created', id: 'price.created' },
        { label: 'price.updated', id: 'price.updated' },
        { label: 'price.deleted', id: 'price.deleted' },

        // Payment Methods
        { label: 'payment_method.attached', id: 'payment_method.attached' },
        { label: 'payment_method.detached', id: 'payment_method.detached' },
        { label: 'payment_method.updated', id: 'payment_method.updated' },
        {
          label: 'payment_method.automatically_updated',
          id: 'payment_method.automatically_updated',
        },

        // Setup Intents
        { label: 'setup_intent.succeeded', id: 'setup_intent.succeeded' },
        { label: 'setup_intent.setup_failed', id: 'setup_intent.setup_failed' },
        { label: 'setup_intent.canceled', id: 'setup_intent.canceled' },

        // Refunds
        { label: 'refund.created', id: 'refund.created' },
        { label: 'refund.updated', id: 'refund.updated' },
        { label: 'refund.failed', id: 'refund.failed' },

        // Checkout Sessions
        { label: 'checkout.session.completed', id: 'checkout.session.completed' },
        { label: 'checkout.session.expired', id: 'checkout.session.expired' },
        {
          label: 'checkout.session.async_payment_succeeded',
          id: 'checkout.session.async_payment_succeeded',
        },
        {
          label: 'checkout.session.async_payment_failed',
          id: 'checkout.session.async_payment_failed',
        },

        // Payouts
        { label: 'payout.created', id: 'payout.created' },
        { label: 'payout.updated', id: 'payout.updated' },
        { label: 'payout.paid', id: 'payout.paid' },
        { label: 'payout.failed', id: 'payout.failed' },
        { label: 'payout.canceled', id: 'payout.canceled' },

        // Coupons
        { label: 'coupon.created', id: 'coupon.created' },
        { label: 'coupon.updated', id: 'coupon.updated' },
        { label: 'coupon.deleted', id: 'coupon.deleted' },

        // Credit Notes
        { label: 'credit_note.created', id: 'credit_note.created' },
        { label: 'credit_note.updated', id: 'credit_note.updated' },
        { label: 'credit_note.voided', id: 'credit_note.voided' },

        // Account
        { label: 'account.updated', id: 'account.updated' },
        { label: 'account.application.deauthorized', id: 'account.application.deauthorized' },

        // Balance
        { label: 'balance.available', id: 'balance.available' },
      ],
      placeholder: 'Leave empty to receive all events',
      description:
        'Select specific Stripe events to filter. Leave empty to receive all events from Stripe.',
      mode: 'trigger',
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Signing Secret',
      type: 'short-input',
      placeholder: 'whsec_...',
      description:
        'Your webhook signing secret from Stripe Dashboard. Used to verify webhook authenticity.',
      password: true,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Go to your Stripe Dashboard at <a href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noopener noreferrer">https://dashboard.stripe.com/webhooks</a>',
        'Click "Add destination" button',
        'In "Events to send", select the events you want to listen to (must match the events selected above, or select "Select all events" to receive everything)',
        'Select `Webhook Endpoint`, press continue, and paste the <strong>Webhook URL</strong> above into the "Endpoint URL" field',
        'Click "Create Destination" to save',
        'After creating the endpoint, click "Reveal" next to "Signing secret" and copy it',
        'Paste the signing secret into the <strong>Webhook Signing Secret</strong> field above',
        'Click "Save" to activate your webhook trigger',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'stripe_webhook',
    },
  ],

  outputs: {
    id: {
      type: 'string',
      description: 'Unique identifier for the event',
    },
    type: {
      type: 'string',
      description: 'Event type (e.g., payment_intent.succeeded, customer.created, invoice.paid)',
    },
    object: {
      type: 'string',
      description: 'Always "event"',
    },
    api_version: {
      type: 'string',
      description: 'Stripe API version used to render the event',
    },
    created: {
      type: 'number',
      description: 'Unix timestamp when the event was created',
    },
    data: {
      type: 'json',
      description: 'Event data containing the affected Stripe object',
    },
    livemode: {
      type: 'boolean',
      description: 'Whether this event occurred in live mode (true) or test mode (false)',
    },
    pending_webhooks: {
      type: 'number',
      description: 'Number of webhooks yet to be delivered for this event',
    },
    request: {
      type: 'json',
      description: 'Information about the request that triggered this event',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
