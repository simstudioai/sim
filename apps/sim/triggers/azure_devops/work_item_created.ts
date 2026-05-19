import { AzureDevOpsIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  azureDevOpsTriggerOptions,
  buildWorkItemCreatedOutputs,
  workItemCreatedSetupInstructions,
} from '@/triggers/azure_devops/utils'
import type { TriggerConfig } from '@/triggers/types'

export const azureDevOpsWorkItemCreatedTrigger: TriggerConfig = {
  id: 'azure_devops_work_item_created',
  name: 'Azure DevOps Work Item Created',
  provider: 'azure_devops',
  description: 'Trigger workflow when a work item is created in Azure DevOps',
  version: '1.0.0',
  icon: AzureDevOpsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'azure_devops_work_item_created',
    triggerOptions: azureDevOpsTriggerOptions,
    setupInstructions: workItemCreatedSetupInstructions,
  }),

  outputs: buildWorkItemCreatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
