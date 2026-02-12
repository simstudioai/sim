import { JiraIcon } from '@/components/icons'
import { buildBoardOutputs, jiraSetupInstructions } from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Board Updated Trigger
 * Triggers when a board is updated in Jira
 */
export const jiraBoardUpdatedTrigger: TriggerConfig = {
  id: 'jira_board_updated',
  name: 'Jira Board Updated',
  provider: 'jira',
  description: 'Trigger workflow when a board is updated in Jira',
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
        value: 'jira_board_updated',
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
        value: 'jira_board_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jira_board_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_board_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jiraSetupInstructions('board_updated'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_board_updated',
      },
    },
  ],

  outputs: buildBoardOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
