import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIssueOutputs,
  buildJiraExtraFields,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Issue Deleted Trigger
 * Triggers when an issue is deleted in Jira
 */
export const jiraIssueDeletedTrigger: TriggerConfig = {
  id: 'jira_issue_deleted',
  name: 'Jira Issue Deleted',
  provider: 'jira',
  description: 'Trigger workflow when an issue is deleted in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_issue_deleted',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('jira:issue_deleted'),
    extraFields: buildJiraExtraFields(
      'jira_issue_deleted',
      'Filter which issue deletions trigger this workflow using JQL'
    ),
  }),

  outputs: buildIssueOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
