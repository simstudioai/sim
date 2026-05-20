import { AzureDevOpsIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  azureDevOpsTriggerOptions,
  buildWebhookOutputs,
  webhookSetupInstructions,
} from '@/triggers/azure_devops/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Azure DevOps generic webhook trigger.
 * Event filtering is determined by which events you enable on the service hook subscription.
 */
export const azureDevOpsWebhookTrigger: TriggerConfig = {
  id: 'azure_devops_webhook',
  name: 'Azure DevOps Webhook (All Service Hook Events)',
  provider: 'azure_devops',
  description:
    'Trigger on whichever service hook event types you configure in Azure DevOps. Sim does not filter deliveries for this trigger.',
  version: '1.0.0',
  icon: AzureDevOpsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'azure_devops_webhook',
    triggerOptions: azureDevOpsTriggerOptions,
    setupInstructions: webhookSetupInstructions,
  }),

  outputs: buildWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
