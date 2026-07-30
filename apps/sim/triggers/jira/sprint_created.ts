import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildJiraExtraFields,
  buildSprintOutputs,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Sprint Created Trigger
 * Triggers when a sprint is created
 */
export const jiraSprintCreatedTrigger: TriggerConfig = {
  id: 'jira_sprint_created',
  name: 'Jira Sprint Created',
  provider: 'jira',
  description: 'Trigger workflow when a sprint is created in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_sprint_created',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('sprint_created'),
    extraFields: buildJiraExtraFields('jira_sprint_created'),
  }),

  outputs: buildSprintOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
