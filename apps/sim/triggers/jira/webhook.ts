import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildCommentOutputs,
  buildIssueUpdatedOutputs,
  buildJiraExtraFields,
  buildProjectCreatedOutputs,
  buildSprintOutputs,
  buildVersionReleasedOutputs,
  buildWorklogOutputs,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic Jira Webhook Trigger
 * Captures all Jira webhook events
 */
export const jiraWebhookTrigger: TriggerConfig = {
  id: 'jira_webhook',
  name: 'Jira Webhook (All Events)',
  provider: 'jira',
  description: 'Trigger workflow on any Jira webhook event',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_webhook',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('All Events'),
    extraFields: buildJiraExtraFields('jira_webhook'),
  }),

  outputs: {
    ...buildIssueUpdatedOutputs(),
    comment: buildCommentOutputs().comment,
    worklog: buildWorklogOutputs().worklog,
    sprint: buildSprintOutputs().sprint,
    project: buildProjectCreatedOutputs().project,
    version: buildVersionReleasedOutputs().version,
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
