import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGreenhouseExtraFields,
  buildWebhookOutputs,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse Generic Webhook Trigger
 *
 * Accepts all Greenhouse webhook events without filtering.
 */
export const greenhouseWebhookTrigger: TriggerConfig = {
  id: 'greenhouse_webhook',
  name: 'Greenhouse Webhook (All Events)',
  provider: 'greenhouse',
  description: 'Trigger workflow on any Greenhouse webhook event',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_webhook',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('All Events'),
    extraFields: buildGreenhouseExtraFields('greenhouse_webhook'),
  }),

  outputs: buildWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
