import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildProjectOutputs, linearSetupInstructions } from './utils'

export const linearProjectCreatedTrigger: TriggerConfig = {
  id: 'linear_project_created',
  name: 'Linear Project Created',
  provider: 'linear',
  description: 'Trigger workflow when a new project is created in Linear',
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
        value: 'linear_project_created',
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
        value: 'linear_project_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Project (create)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_project_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_project_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_project_created',
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
          type: 'Project',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T10:00:00.000Z',
          actor: {
            id: 'user_123',
            type: 'user',
            name: 'John Doe',
          },
          data: {
            id: 'project_567',
            name: 'Q4 Authentication Improvements',
            description: 'Comprehensive authentication and security improvements for Q4 2025',
            icon: '🔐',
            color: '#4285F4',
            state: 'planned',
            slugId: 'q4-auth',
            url: 'https://linear.app/acme/project/q4-auth',
            leadId: 'user_123',
            creatorId: 'user_123',
            memberIds: ['user_123', 'user_234', 'user_345'],
            teamIds: ['team_456'],
            priority: 1,
            sortOrder: 100.5,
            startDate: '2025-10-01',
            targetDate: '2025-12-31',
            startedAt: null,
            completedAt: null,
            canceledAt: null,
            archivedAt: null,
            createdAt: '2025-11-06T10:00:00.000Z',
            updatedAt: '2025-11-06T10:00:00.000Z',
            progress: 0,
            scope: 0,
            statusId: 'status_planned',
            bodyData: null,
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
        value: 'linear_project_created',
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
