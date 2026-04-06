import { SalesforceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildSalesforceWebhookOutputs,
  salesforceSetupInstructions,
  salesforceTriggerOptions,
} from '@/triggers/salesforce/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Salesforce Generic Webhook Trigger
 *
 * Receives all Salesforce events via a single webhook endpoint.
 */
export const salesforceWebhookTrigger: TriggerConfig = {
  id: 'salesforce_webhook',
  name: 'Salesforce Webhook (All Events)',
  provider: 'salesforce',
  description: 'Trigger workflow on any Salesforce webhook event',
  version: '1.0.0',
  icon: SalesforceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'salesforce_webhook',
    triggerOptions: salesforceTriggerOptions,
    setupInstructions: salesforceSetupInstructions('All Events'),
  }),

  outputs: buildSalesforceWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
