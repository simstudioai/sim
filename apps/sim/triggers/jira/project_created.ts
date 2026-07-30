import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildJiraExtraFields,
  buildProjectCreatedOutputs,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Project Created Trigger
 * Triggers when a project is created
 */
export const jiraProjectCreatedTrigger: TriggerConfig = {
  id: 'jira_project_created',
  name: 'Jira Project Created',
  provider: 'jira',
  description: 'Trigger workflow when a project is created in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_project_created',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('project_created'),
    extraFields: buildJiraExtraFields('jira_project_created'),
  }),

  outputs: buildProjectCreatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
