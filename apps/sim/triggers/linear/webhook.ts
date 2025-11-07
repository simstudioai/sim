import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { linearSetupInstructions, linearWebhookSubBlocks, userOutputs } from './utils'

export const linearWebhookTrigger: TriggerConfig = {
  id: 'linear_webhook',
  name: 'Linear Webhook',
  provider: 'linear',
  description: 'Trigger workflow from any Linear webhook event',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    ...linearWebhookSubBlocks,
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions(
        'all events',
        'This webhook will receive all Linear events. Use the <code>type</code> and <code>action</code> fields in the payload to filter and handle different event types.'
      ),
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_webhook',
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          action: 'create',
          type: 'Issue',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T12:00:00.000Z',
          actor: {
            id: 'user_123',
            type: 'user',
            name: 'John Doe',
          },
          data: {
            id: 'entity_id',
            // ... entity-specific fields
          },
          updatedFrom: {
            // ... previous values (only present on update actions)
          },
        },
        null,
        2
      ),
      readOnly: true,
      collapsible: true,
      defaultCollapsed: true,
      mode: 'trigger',
    },
  ],

  outputs: {
    action: {
      type: 'string',
      description: 'Action performed (create, update, remove)',
    },
    type: {
      type: 'string',
      description: 'Entity type (Issue, Comment, Project, Cycle, IssueLabel, ProjectUpdate, etc.)',
    },
    webhookId: {
      type: 'string',
      description: 'Webhook ID',
    },
    webhookTimestamp: {
      type: 'number',
      description: 'Webhook timestamp (milliseconds)',
    },
    organizationId: {
      type: 'string',
      description: 'Organization ID',
    },
    createdAt: {
      type: 'string',
      description: 'Event creation timestamp',
    },
    actor: userOutputs,
    data: {
      type: 'object',
      description: 'Complete entity data object',
    },
    updatedFrom: {
      type: 'object',
      description: 'Previous values for changed fields (only present on update)',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Issue',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
