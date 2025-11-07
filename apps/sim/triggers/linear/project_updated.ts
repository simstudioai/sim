import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildProjectOutputs, linearSetupInstructions, linearWebhookSubBlocks } from './utils'

export const linearProjectUpdatedTrigger: TriggerConfig = {
  id: 'linear_project_updated',
  name: 'Linear Project Updated',
  provider: 'linear',
  description: 'Trigger workflow when a project is updated in Linear',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    ...linearWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_project_updated',
      },
    })),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Project (update)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_project_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_project_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_project_updated',
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
          type: 'Project',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730940000000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T14:00:00.000Z',
          actor: {
            id: 'user_234',
            type: 'user',
            name: 'Jane Smith',
          },
          data: {
            id: 'project_567',
            name: 'Q4 Authentication Improvements',
            description:
              'Comprehensive authentication and security improvements for Q4 2025, including SSO integration',
            icon: '🔐',
            color: '#4285F4',
            state: 'started',
            slugId: 'q4-auth',
            url: 'https://linear.app/acme/project/q4-auth',
            leadId: 'user_234',
            creatorId: 'user_123',
            memberIds: ['user_123', 'user_234', 'user_345', 'user_456'],
            teamIds: ['team_456', 'team_789'],
            priority: 0,
            sortOrder: 100.5,
            startDate: '2025-10-01',
            targetDate: '2025-12-31',
            startedAt: '2025-11-06T14:00:00.000Z',
            completedAt: null,
            canceledAt: null,
            archivedAt: null,
            createdAt: '2025-11-06T10:00:00.000Z',
            updatedAt: '2025-11-06T14:00:00.000Z',
            progress: 0.35,
            scope: 8,
            statusId: 'status_in_progress',
            bodyData: null,
          },
          updatedFrom: {
            description: 'Comprehensive authentication and security improvements for Q4 2025',
            state: 'planned',
            leadId: 'user_123',
            priority: 1,
            startedAt: null,
            updatedAt: '2025-11-06T10:00:00.000Z',
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
        value: 'linear_project_updated',
      },
    },
  ],

  outputs: buildProjectOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Project',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
