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
 * Jira Comment Deleted Trigger
 * Triggers when a comment on an issue is deleted
 */
export const jiraCommentDeletedTrigger: TriggerConfig = {
  id: 'jira_comment_deleted',
  name: 'Jira Comment Deleted',
  provider: 'jira',
  description: 'Trigger workflow when a comment is deleted from a Jira issue',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_comment_deleted',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('comment_deleted'),
    extraFields: buildJiraExtraFields(
      'jira_comment_deleted',
      'Filter which comment deletions trigger this workflow using JQL'
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
