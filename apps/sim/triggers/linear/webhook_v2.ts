import { LinearIcon } from '@/components/icons'
import { buildLinearV2SubBlocks, userOutputs } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearWebhookV2Trigger: TriggerConfig = {
  id: 'linear_webhook_v2',
  name: 'Linear Webhook',
  provider: 'linear',
  description: 'Trigger workflow from any Linear webhook event',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_webhook_v2',
    eventType: 'All Events',
    additionalNotes:
      'This webhook will receive all Linear events. Use the <code>type</code> and <code>action</code> fields in the payload to filter and handle different event types.',
  }),

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
