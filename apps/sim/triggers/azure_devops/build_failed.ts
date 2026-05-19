import { AzureDevOpsIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  azureDevOpsTriggerOptions,
  buildBuildFailedOutputs,
  buildFailedSetupInstructions,
} from '@/triggers/azure_devops/utils'
import type { TriggerConfig } from '@/triggers/types'

export const azureDevOpsBuildFailedTrigger: TriggerConfig = {
  id: 'azure_devops_build_failed',
  name: 'Azure DevOps Build Failed',
  provider: 'azure_devops',
  description:
    'Trigger workflow when an Azure DevOps build fails, is canceled, or partially succeeds',
  version: '1.0.0',
  icon: AzureDevOpsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'azure_devops_build_failed',
    triggerOptions: azureDevOpsTriggerOptions,
    includeDropdown: true,
    setupInstructions: buildFailedSetupInstructions,
  }),

  outputs: buildBuildFailedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
