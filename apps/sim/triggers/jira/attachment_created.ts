import { JiraIcon } from '@/components/icons'
import { buildAttachmentOutputs, jiraSetupInstructions } from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Attachment Created Trigger
 * Triggers when an attachment is added to a Jira issue
 */
export const jiraAttachmentCreatedTrigger: TriggerConfig = {
  id: 'jira_attachment_created',
  name: 'Jira Attachment Created',
  provider: 'jira',
  description: 'Trigger workflow when an attachment is added to a Jira issue',
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
        value: 'jira_attachment_created',
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
        value: 'jira_attachment_created',
      },
    },
    {
      id: 'apiEmail',
      title: 'Jira Account Email',
      type: 'short-input',
      placeholder: 'you@company.com',
      description: 'Your Jira account email. Required for downloading file attachments.',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_attachment_created',
      },
    },
    {
      id: 'apiToken',
      title: 'Jira API Token',
      type: 'short-input',
      placeholder: 'Enter your Jira API token',
      description:
        'API token from https://id.atlassian.com/manage-profile/security/api-tokens. Required for downloading file attachments.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_attachment_created',
      },
    },
    {
      id: 'includeAttachments',
      title: 'Include File Attachments',
      type: 'switch',
      defaultValue: false,
      description:
        'Download and include file attachments as UserFile objects. Requires Jira account email and API token.',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_attachment_created',
      },
    },
    {
      id: 'jqlFilter',
      title: 'JQL Filter',
      type: 'long-input',
      placeholder: 'project = PROJ',
      description: 'Filter which attachment events trigger this workflow using JQL',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_attachment_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jira_attachment_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_attachment_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jiraSetupInstructions(
        'attachment_created',
        '<strong>File Downloads:</strong> To download attachment files, provide your Jira account email and API token above, then enable "Include File Attachments". You can generate an API token at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">Atlassian API Tokens</a>.'
      ),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_attachment_created',
      },
    },
  ],

  outputs: buildAttachmentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
