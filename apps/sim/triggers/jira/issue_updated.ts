import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIssueUpdatedOutputs,
  buildJiraExtraFields,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Issue Updated Trigger
 * Triggers when an existing issue is updated in Jira
 */
export const jiraIssueUpdatedTrigger: TriggerConfig = {
  id: 'jira_issue_updated',
  name: 'Jira Issue Updated',
  provider: 'jira',
  description: 'Trigger workflow when an issue is updated in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_issue_updated',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('jira:issue_updated'),
    extraFields: buildJiraExtraFields(
      'jira_issue_updated',
      'Filter which issue updates trigger this workflow using JQL'
    ),
  }),

  outputs: buildIssueUpdatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
