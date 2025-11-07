import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, jiraSetupInstructions, jiraWebhookSubBlocks } from './utils'

/**
 * Generic Jira Webhook Trigger
 * Captures all Jira webhook events
 */
export const jiraWebhookTrigger: TriggerConfig = {
  id: 'jira_webhook',
  name: 'Jira Webhook (All Events)',
  provider: 'jira',
  description:
    'Trigger workflow on any Jira webhook event. Receives all Jira events including issue created, updated, deleted, commented, and worklog events.',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: [
        { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
        { label: 'Issue Created', id: 'jira_issue_created' },
        { label: 'Issue Updated', id: 'jira_issue_updated' },
        { label: 'Issue Deleted', id: 'jira_issue_deleted' },
        { label: 'Issue Commented', id: 'jira_issue_commented' },
        { label: 'Worklog Created', id: 'jira_worklog_created' },
      ],
      value: () => 'jira_webhook',
      required: true,
    },
    ...jiraWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_webhook',
      },
    })),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: jiraSetupInstructions('All Events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'jira_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_webhook',
      },
    },
  ],

  outputs: {
    ...buildIssueOutputs(),
    // Add comment-specific outputs (may or may not be present)
    comment: {
      type: 'json',
      description: 'Comment object (for comment events)',
    },
    comment_id: {
      type: 'string',
      description: 'Comment ID (for comment events)',
    },
    comment_body: {
      type: 'string',
      description: 'Comment text (for comment events)',
    },
    // Add worklog-specific outputs (may or may not be present)
    worklog: {
      type: 'json',
      description: 'Worklog object (for worklog events)',
    },
    worklog_id: {
      type: 'string',
      description: 'Worklog ID (for worklog events)',
    },
    time_spent: {
      type: 'string',
      description: 'Time spent (for worklog events)',
    },
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
