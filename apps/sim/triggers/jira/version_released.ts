import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildJiraExtraFields,
  buildVersionReleasedOutputs,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Version Released Trigger
 * Triggers when a version/release is released
 */
export const jiraVersionReleasedTrigger: TriggerConfig = {
  id: 'jira_version_released',
  name: 'Jira Version Released',
  provider: 'jira',
  description: 'Trigger workflow when a version is released in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_version_released',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('jira:version_released'),
    extraFields: buildJiraExtraFields('jira_version_released'),
  }),

  outputs: buildVersionReleasedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
