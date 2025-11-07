import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCycleOutputs, linearSetupInstructions, linearWebhookSubBlocks } from './utils'

export const linearCycleUpdatedTrigger: TriggerConfig = {
  id: 'linear_cycle_updated',
  name: 'Linear Cycle Updated',
  provider: 'linear',
  description: 'Trigger workflow when a cycle is updated in Linear',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    ...linearWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_updated',
      },
    })),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Cycle (update)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_cycle_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_cycle_updated',
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
          type: 'Cycle',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730997600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-18T00:00:00.000Z',
          actor: {
            id: 'user_123',
            type: 'user',
            name: 'John Doe',
          },
          data: {
            id: 'cycle_890',
            number: 12,
            name: 'Cycle 12',
            description: 'November 2025 sprint - Completed successfully!',
            teamId: 'team_456',
            startsAt: '2025-11-04T00:00:00.000Z',
            endsAt: '2025-11-17T23:59:59.000Z',
            completedAt: '2025-11-18T00:00:00.000Z',
            archivedAt: null,
            autoArchivedAt: null,
            createdAt: '2025-11-06T09:00:00.000Z',
            updatedAt: '2025-11-18T00:00:00.000Z',
            progress: 1,
            scopeHistory: [5, 8, 8],
            completedScopeHistory: [0, 3, 8],
            inProgressScopeHistory: [2, 3, 0],
          },
          updatedFrom: {
            description: 'November 2025 sprint',
            completedAt: null,
            updatedAt: '2025-11-06T09:00:00.000Z',
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
        value: 'linear_cycle_updated',
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
