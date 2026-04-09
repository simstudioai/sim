import { ServiceNowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildServiceNowExtraFields,
  buildServiceNowWebhookOutputs,
  servicenowSetupInstructions,
  servicenowTriggerOptions,
} from '@/triggers/servicenow/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic ServiceNow Webhook Trigger
 * Captures all ServiceNow webhook events
 */
export const servicenowWebhookTrigger: TriggerConfig = {
  id: 'servicenow_webhook',
  name: 'ServiceNow Webhook (All Events)',
  provider: 'servicenow',
  description: 'Trigger workflow on any ServiceNow webhook event',
  version: '1.0.0',
  icon: ServiceNowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'servicenow_webhook',
    triggerOptions: servicenowTriggerOptions,
    setupInstructions: servicenowSetupInstructions('Insert, Update, or Delete'),
    extraFields: buildServiceNowExtraFields('servicenow_webhook'),
  }),

  outputs: buildServiceNowWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
