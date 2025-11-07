import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildProjectUpdateOutputs, linearSetupInstructions } from './utils'

export const linearProjectUpdateCreatedTrigger: TriggerConfig = {
  id: 'linear_project_update_created',
  name: 'Linear Project Update Created',
  provider: 'linear',
  description: 'Trigger workflow when a new project update is posted in Linear',
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
        value: 'linear_project_update_created',
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
        value: 'linear_project_update_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('ProjectUpdate (create)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_project_update_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_project_update_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_project_update_created',
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
          type: 'ProjectUpdate',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T16:00:00.000Z',
          actor: {
            id: 'user_234',
            type: 'user',
            name: 'Jane Smith',
          },
          data: {
            id: 'update_pqr456',
            body: 'Great progress this week! We completed the OAuth2 implementation and started on SSO integration. All tests passing.',
            url: 'https://linear.app/acme/project/q4-auth/updates/pqr456',
            projectId: 'project_567',
            userId: 'user_234',
            health: 'onTrack',
            editedAt: null,
            createdAt: '2025-11-06T16:00:00.000Z',
            updatedAt: '2025-11-06T16:00:00.000Z',
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
        value: 'linear_project_update_created',
      },
    },
  ],

  outputs: buildProjectUpdateOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'ProjectUpdate',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
