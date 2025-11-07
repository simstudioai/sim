import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCycleOutputs, linearSetupInstructions } from './utils'

export const linearCycleCreatedTrigger: TriggerConfig = {
  id: 'linear_cycle_created',
  name: 'Linear Cycle Created',
  provider: 'linear',
  description: 'Trigger workflow when a new cycle is created in Linear',
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
        value: 'linear_cycle_created',
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
        value: 'linear_cycle_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Cycle (create)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_cycle_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_created',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          action: 'create',
          type: 'Cycle',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T09:00:00.000Z',
          actor: {
            id: 'user_123',
            type: 'user',
            name: 'John Doe',
          },
          data: {
            id: 'cycle_890',
            number: 12,
            name: 'Cycle 12',
            description: 'November 2025 sprint',
            teamId: 'team_456',
            startsAt: '2025-11-04T00:00:00.000Z',
            endsAt: '2025-11-17T23:59:59.000Z',
            completedAt: null,
            archivedAt: null,
            autoArchivedAt: null,
            createdAt: '2025-11-06T09:00:00.000Z',
            updatedAt: '2025-11-06T09:00:00.000Z',
            progress: 0,
            scopeHistory: [],
            completedScopeHistory: [],
            inProgressScopeHistory: [],
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
        value: 'linear_cycle_created',
      },
    },
  ],

  outputs: buildCycleOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Cycle',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
