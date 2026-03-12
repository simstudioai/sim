import { AshbyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  ashbySetupInstructions,
  ashbyTriggerOptions,
  buildAshbyExtraFields,
  buildAshbyWebhookOutputs,
} from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic Ashby Webhook Trigger
 *
 * Creates a webhook without filtering by event type, capturing all Ashby events.
 * Note: Ashby requires one webhook per event type, so the generic trigger
 * will not filter by webhookType, receiving whatever type is configured.
 */
export const ashbyWebhookTrigger: TriggerConfig = {
  id: 'ashby_webhook',
  name: 'Ashby Webhook (All Events)',
  provider: 'ashby',
  description: 'Trigger workflow on any Ashby webhook event',
  version: '1.0.0',
  icon: AshbyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'ashby_webhook',
    triggerOptions: ashbyTriggerOptions,
    setupInstructions: ashbySetupInstructions('All Events'),
    extraFields: buildAshbyExtraFields('ashby_webhook'),
  }),

  outputs: buildAshbyWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
