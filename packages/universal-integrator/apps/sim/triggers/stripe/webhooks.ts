/**
 * Stripe Webhook Triggers
 */

import { TriggerConfig } from '@sim/workflow-types';

export const stripeWebhookTrigger: TriggerConfig = {
  id: 'stripe_webhook',
  name: 'Webhook',
  type: 'webhook',
  includeDropdown: true,
  method: 'POST',
  path: '/webhook/stripe/{botId}/{workspaceId}',

  outputs: {
    event_type: { type: 'string' },
    object_id: { type: 'string' },
    timestamp: { type: 'number' },
    data: { type: 'json' },
  },

  formatInput: (payload: any) => ({
    event_type: payload.type,
    object_id: payload.data?.object?.id,
    timestamp: payload.created,
    data: payload.data?.object,
  }),
};

export const stripeChargeCompletedTrigger: TriggerConfig = {
  id: 'stripe_charge_completed',
  name: 'Charge Completed',
  type: 'webhook',
  method: 'POST',
  path: '/webhook/stripe/{botId}/{workspaceId}',

  outputs: {
    charge_id: { type: 'string' },
    amount: { type: 'number' },
    currency: { type: 'string' },
    customer_id: { type: 'string', optional: true },
  },

  formatInput: (payload: any) => {
    if (payload.type !== 'charge.completed') return null;
    return {
      charge_id: payload.data.object.id,
      amount: payload.data.object.amount,
      currency: payload.data.object.currency,
      customer_id: payload.data.object.customer ?? null,
    };
  },
};
