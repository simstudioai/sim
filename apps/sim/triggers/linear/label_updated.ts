import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildLabelOutputs, linearSetupInstructions } from './utils'

export const linearLabelUpdatedTrigger: TriggerConfig = {
  id: 'linear_label_updated',
  name: 'Linear Label Updated',
  provider: 'linear',
  description: 'Trigger workflow when a label is updated in Linear',
  version: '1.0.0',
  icon: LinearIcon,

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
        value: 'linear_label_updated',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description: 'Validates that webhook deliveries originate from Linear.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_label_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('IssueLabel (update)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_label_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_label_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_label_updated',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          action: 'update',
          type: 'IssueLabel',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730938800000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T11:20:00.000Z',
          actor: {
            id: 'user_234',
            type: 'user',
            name: 'Jane Smith',
          },
          data: {
            id: 'label_333',
            name: 'security',
            description: 'Security and vulnerability-related issues',
            color: '#ff3333',
            teamId: 'team_456',
            creatorId: 'user_123',
            isGroup: false,
            parentId: null,
            archivedAt: null,
            createdAt: '2025-11-06T11:00:00.000Z',
            updatedAt: '2025-11-06T11:20:00.000Z',
          },
          updatedFrom: {
            description: 'Security-related issues',
            color: '#ff0000',
            updatedAt: '2025-11-06T11:00:00.000Z',
          },
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_label_updated',
      },
    },
  ],

  outputs: buildLabelOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'IssueLabel',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
