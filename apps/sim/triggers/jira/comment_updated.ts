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
 * Jira Comment Updated Trigger
 * Triggers when a comment on an issue is updated
 */
export const jiraCommentUpdatedTrigger: TriggerConfig = {
  id: 'jira_comment_updated',
  name: 'Jira Comment Updated',
  provider: 'jira',
  description: 'Trigger workflow when a comment is updated on a Jira issue',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_comment_updated',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('comment_updated'),
    extraFields: buildJiraExtraFields(
      'jira_comment_updated',
      'Filter which comment updates trigger this workflow using JQL'
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
