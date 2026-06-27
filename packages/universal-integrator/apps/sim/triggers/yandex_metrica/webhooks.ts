/**
 * Yandex Metrica Webhook Triggers
 */

import { TriggerConfig } from '@sim/workflow-types';

export const yandexMetricaWebhookTrigger: TriggerConfig = {
  id: 'yandex_metrica_webhook',
  name: 'Webhook',
  type: 'webhook',
  includeDropdown: true,
  method: 'POST',
  path: '/webhook/yandex-metrica/{botId}/{workspaceId}',

  outputs: {
    event_type: { type: 'string', description: 'visit, goal, ecommerce' },
    counter_id: { type: 'number' },
    user_id: { type: 'string', optional: true },
    timestamp: { type: 'number' },
    data: { type: 'json' },
  },

  formatInput: (payload: any) => ({
    event_type: payload.event_type,
    counter_id: payload.counter_id,
    user_id: payload.user_id ?? null,
    timestamp: payload.timestamp,
    data: payload.data,
  }),
};

export const yandexMetricaGoalEventTrigger: TriggerConfig = {
  id: 'yandex_metrica_goal_event',
  name: 'Goal Event',
  type: 'webhook',
  method: 'POST',
  path: '/webhook/yandex-metrica/{botId}/{workspaceId}',

  outputs: {
    goal_id: { type: 'number' },
    goal_name: { type: 'string' },
    user_id: { type: 'string' },
    counter_id: { type: 'number' },
    value: { type: 'number', optional: true },
  },

  formatInput: (payload: any) => {
    if (payload.event_type !== 'goal') return null;
    return {
      goal_id: payload.data?.goal_id,
      goal_name: payload.data?.goal_name,
      user_id: payload.user_id,
      counter_id: payload.counter_id,
      value: payload.data?.value ?? null,
    };
  },
};
