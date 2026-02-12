import { JiraIcon } from '@/components/icons'
import { buildSprintOutputs, jiraSetupInstructions } from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Sprint Started Trigger
 * Triggers when a sprint is started in Jira
 */
export const jiraSprintStartedTrigger: TriggerConfig = {
  id: 'jira_sprint_started',
  name: 'Jira Sprint Started',
  provider: 'jira',
  description: 'Trigger workflow when a sprint is started in Jira',
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
        value: 'jira_sprint_started',
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
        value: 'jira_sprint_started',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jira_sprint_started',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_sprint_started',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jiraSetupInstructions('sprint_started'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_sprint_started',
      },
    },
  ],

  outputs: buildSprintOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
