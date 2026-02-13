import { JiraIcon } from '@/components/icons'
import { buildVersionOutputs, jiraSetupInstructions } from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Version Unreleased Trigger
 * Triggers when a version is unreleased in Jira
 */
export const jiraVersionUnreleasedTrigger: TriggerConfig = {
  id: 'jira_version_unreleased',
  name: 'Jira Version Unreleased',
  provider: 'jira',
  description: 'Trigger workflow when a version is unreleased in Jira',
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
        value: 'jira_version_unreleased',
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
        value: 'jira_version_unreleased',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jira_version_unreleased',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_version_unreleased',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jiraSetupInstructions('jira:version_unreleased'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_version_unreleased',
      },
    },
  ],

  outputs: buildVersionOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
