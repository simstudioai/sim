import { MondayIcon } from '@/components/icons'
import { createLogger } from '@sim/logger'
import type { TriggerConfig } from '@/triggers/types'
import { mondayTriggerOptions } from './utils'

const logger = createLogger('MondayNewItemTrigger')

export const mondayNewItemTrigger: TriggerConfig = {
  id: 'monday_new_item',
  name: 'Monday.com New Item',
  provider: 'monday',
  description: 'Triggers when a new item is added to a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: mondayTriggerOptions,
      value: () => 'monday_new_item',
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
        value: 'monday_new_item',
      },
    },
    {
      id: 'boardId',
      title: 'Board to Monitor',
      type: 'file-selector',
      serviceId: 'monday',
      placeholder: 'Select a Monday.com board',
      description: 'The board to monitor for new items',
      required: true,
      dependsOn: ['apiKey'],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_new_item',
      },
    },
    {
      id: 'groupId',
      title: 'Group Filter (Optional)',
      type: 'file-selector',
      serviceId: 'monday',
      placeholder: 'All groups',
      description: 'Filter by specific group (optional)',
      required: false,
      dependsOn: ['apiKey', 'boardId'],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_new_item',
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
        value: 'monday_new_item',
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
        'The webhook will send real-time notifications when new item is added',
      ]
        .map((instruction, index) => `${index + 1}. ${instruction}`)
        .join('\n'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_new_item',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'monday_new_item',
      condition: {
        field: 'selectedTriggerId',
        value: 'monday_new_item',
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
