import { MondayIcon } from '@/components/icons'
import { createLogger } from '@sim/logger'
import type { TriggerConfig } from '@/triggers/types'
import { mondayTriggerOptions } from './utils'

const logger = createLogger('MondayColumnChangedTrigger')

export const mondayColumnChangedTrigger: TriggerConfig = {
  id: 'monday_column_changed',
  name: 'Monday.com Column Changed',
  provider: 'monday',
  description: 'Triggers when a specific column value changes in a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: mondayTriggerOptions,
      value: () => 'monday_column_changed',
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      description: 'Your Monday.com API key (get it from Admin > API section)',
      placeholder: 'Enter API key',
      password: true,
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_column_changed',
      },
    },
    {
      id: 'boardId',
      title: 'Board to Monitor',
      type: 'file-selector',
      serviceId: 'monday',
      placeholder: 'Select a Monday.com board',
      description: 'The board to monitor for column changes',
      required: true,
      dependsOn: ['apiKey'],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_column_changed',
      },
    },
    {
      id: 'columnId',
      title: 'Column to Monitor',
      type: 'file-selector',
      serviceId: 'monday',
      placeholder: 'Select a column',
      description: 'The specific column to monitor for changes',
      required: true,
      dependsOn: ['apiKey', 'boardId'],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_column_changed',
      },
    },
    {
      id: 'specificValue',
      title: 'Specific Value (Optional)',
      type: 'short-input',
      placeholder: 'e.g., "Done" or "Working on it"',
      description: 'Only trigger when column changes to this specific value (optional)',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_column_changed',
      },
    },
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
        value: 'monday_column_changed',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Get your Monday.com API key from Clicking your profile picture > Developers > API Access Tokens.',
        'Copy the Webhook URL above',
        'Select the board and click on automate on the right',
        "search for webhook and paste the copied webhook url",
        'The webhook will send real-time notifications when column values change',
      ]
        .map((instruction, index) => `${index + 1}. ${instruction}`)
        .join('\n'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_column_changed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'monday_column_changed',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_column_changed',
      },
    },
  ],

  outputs: {
    item: {
      id: { type: 'string', description: 'Item ID' },
      name: { type: 'string', description: 'Item name' },
      board_id: { type: 'string', description: 'Board ID' },
      group_id: { type: 'string', description: 'Group ID' },
      column_values: { type: 'json', description: 'All column values' },
      created_at: { type: 'string', description: 'Creation timestamp' },
      updated_at: { type: 'string', description: 'Last update timestamp' },
    },
    old_value: {
      type: 'string',
      description: 'Previous column value',
    },
    new_value: {
      type: 'string',
      description: 'New column value',
    },
    column_id: {
      type: 'string',
      description: 'ID of the changed column',
    },
    column_title: {
      type: 'string',
      description: 'Title of the changed column',
    },
    timestamp: {
      type: 'string',
      description: 'Trigger timestamp',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'monday.com',
    },
  },
}
