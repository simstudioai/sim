import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCommentOutputs, linearSetupInstructions, linearWebhookSubBlocks } from './utils'

export const linearCommentCreatedTrigger: TriggerConfig = {
  id: 'linear_comment_created',
  name: 'Linear Comment Created',
  provider: 'linear',
  description: 'Trigger workflow when a new comment is created in Linear',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    ...linearWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_comment_created',
      },
    })),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Comment (create)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_comment_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_comment_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_comment_created',
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
          type: 'Comment',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T13:00:00.000Z',
          actor: {
            id: 'user_234',
            type: 'user',
            name: 'Jane Smith',
          },
          data: {
            id: 'comment_xyz789',
            body: 'I think we should also add support for Microsoft SSO in this implementation.',
            url: 'https://linear.app/acme/issue/ENG-123#comment-xyz789',
            issueId: 'issue_abc123',
            userId: 'user_234',
            editedAt: null,
            createdAt: '2025-11-06T13:00:00.000Z',
            updatedAt: '2025-11-06T13:00:00.000Z',
            archivedAt: null,
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
        value: 'linear_comment_created',
      },
    },
  ],

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'Comment',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
