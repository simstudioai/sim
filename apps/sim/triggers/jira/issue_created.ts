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
 * Jira Issue Created Trigger
 * Triggers when a new issue is created in Jira
 *
 * Primary trigger — includes the dropdown for selecting trigger type.
 */
export const jiraIssueCreatedTrigger: TriggerConfig = {
  id: 'jira_issue_created',
  name: 'Jira Issue Created',
  provider: 'jira',
  description: 'Trigger workflow when a new issue is created in Jira',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_issue_created',
    triggerOptions: jiraTriggerOptions,
    includeDropdown: true,
    setupInstructions: jiraSetupInstructions('jira:issue_created'),
    extraFields: buildJiraExtraFields(
      'jira_issue_created',
      'Filter which issues trigger this workflow using JQL (Jira Query Language)'
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
