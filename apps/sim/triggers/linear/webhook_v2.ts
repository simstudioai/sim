import { LinearIcon } from '@/components/icons'
import { buildLinearV2SubBlocks, userOutputs } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearWebhookV2Trigger: TriggerConfig = {
  id: 'linear_webhook_v2',
  name: 'Linear Webhook',
  provider: 'linear',
  description:
    'Trigger workflow from Linear data-change events included in this webhook subscription (Issues, Comments, Projects, etc.—not every Linear model).',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_webhook_v2',
    eventType: 'All Events',
    additionalNotes:
      'Sim registers this webhook for Issues, Comments, Projects, Cycles, Issue labels, Project updates, and Customer requests—matching what the Linear API allows in one subscription. It does not include every model Linear documents separately (e.g. Documents, Reactions). Use <code>type</code> and <code>action</code> in the payload to filter.',
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
    url: {
      type: 'string',
      description: 'URL of the subject entity in Linear (top-level webhook payload)',
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
      'Linear-Delivery': '234d1a4e-b617-4388-90fe-adc3633d6b72',
      'Linear-Signature': '766e1d90a96e2f5ecec342a99c5552999dd95d49250171b902d703fd674f5086',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
