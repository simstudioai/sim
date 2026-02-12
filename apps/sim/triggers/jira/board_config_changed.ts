import { JiraIcon } from '@/components/icons'
import { buildBoardOutputs, jiraSetupInstructions } from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Board Config Changed Trigger
 * Triggers when a board configuration is changed in Jira
 */
export const jiraBoardConfigChangedTrigger: TriggerConfig = {
  id: 'jira_board_config_changed',
  name: 'Jira Board Config Changed',
  provider: 'jira',
  description: 'Trigger workflow when a board configuration is changed in Jira',
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
        value: 'jira_board_config_changed',
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
        value: 'jira_board_config_changed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jira_board_config_changed',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_board_config_changed',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jiraSetupInstructions('board_configuration_changed'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_board_config_changed',
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
