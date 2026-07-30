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
 * Jira Sprint Closed Trigger
 * Triggers when a sprint is closed/completed
 */
export const jiraSprintClosedTrigger: TriggerConfig = {
  id: 'jira_sprint_closed',
  name: 'Jira Sprint Closed',
  provider: 'jira',
  description: 'Trigger workflow when a sprint is closed in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_sprint_closed',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('sprint_closed'),
    extraFields: buildJiraExtraFields('jira_sprint_closed'),
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
