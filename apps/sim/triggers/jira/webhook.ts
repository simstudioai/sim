import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, jiraSetupInstructions } from './utils'

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

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_webhook',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description: 'Optional secret to validate webhook deliveries from Jira using HMAC signature',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_webhook',
      },
    },
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
