import { JiraIcon } from '@/components/icons'
import { buildIssueLinkOutputs, jiraSetupInstructions } from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Issue Link Deleted Trigger
 * Triggers when an issue link is deleted in Jira
 */
export const jiraIssueLinkDeletedTrigger: TriggerConfig = {
  id: 'jira_issuelink_deleted',
  name: 'Jira Issue Link Deleted',
  provider: 'jira',
  description: 'Trigger workflow when an issue link is deleted in Jira',
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
        value: 'jira_issuelink_deleted',
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
        value: 'jira_issuelink_deleted',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jira_issuelink_deleted',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issuelink_deleted',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jiraSetupInstructions('issuelink_deleted'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issuelink_deleted',
      },
    },
  ],

  outputs: buildIssueLinkOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
