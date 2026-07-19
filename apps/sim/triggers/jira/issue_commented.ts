import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildCommentOutputs,
  buildJiraExtraFields,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Issue Commented Trigger
 * Triggers when a comment is added to an issue
 */
export const jiraIssueCommentedTrigger: TriggerConfig = {
  id: 'jira_issue_commented',
  name: 'Jira Issue Commented',
  provider: 'jira',
  description: 'Trigger workflow when a comment is added to a Jira issue',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_issue_commented',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('comment_created'),
    extraFields: buildJiraExtraFields(
      'jira_issue_commented',
      'Filter which issue comments trigger this workflow using JQL'
    ),
  }),

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
