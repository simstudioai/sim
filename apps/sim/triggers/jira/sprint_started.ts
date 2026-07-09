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
 * Jira Sprint Started Trigger
 * Triggers when a sprint is started
 */
export const jiraSprintStartedTrigger: TriggerConfig = {
  id: 'jira_sprint_started',
  name: 'Jira Sprint Started',
  provider: 'jira',
  description: 'Trigger workflow when a sprint is started in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_sprint_started',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('sprint_started'),
    extraFields: buildJiraExtraFields('jira_sprint_started'),
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
