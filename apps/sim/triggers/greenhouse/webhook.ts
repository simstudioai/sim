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
 * Greenhouse generic webhook trigger.
 * Event filtering is determined by which events you enable on the Greenhouse webhook endpoint.
 */
export const greenhouseWebhookTrigger: TriggerConfig = {
  id: 'greenhouse_webhook',
  name: 'Greenhouse Webhook (Endpoint Events)',
  provider: 'greenhouse',
  description:
    'Trigger on whichever event types you select for this URL in Greenhouse. Sim does not filter deliveries for this trigger.',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_webhook',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('Greenhouse event types for this URL'),
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
