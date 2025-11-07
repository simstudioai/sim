import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCommentOutputs, linearSetupInstructions, linearWebhookSubBlocks } from './utils'

export const linearCommentUpdatedTrigger: TriggerConfig = {
  id: 'linear_comment_updated',
  name: 'Linear Comment Updated',
  provider: 'linear',
  description: 'Trigger workflow when a comment is updated in Linear',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    ...linearWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_comment_updated',
      },
    })),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Comment (update)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_comment_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_comment_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_comment_updated',
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
          type: 'Comment',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937900000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T13:05:00.000Z',
          actor: {
            id: 'user_234',
            type: 'user',
            name: 'Jane Smith',
          },
          data: {
            id: 'comment_xyz789',
            body: 'I think we should also add support for Microsoft SSO and Apple Sign-In in this implementation.',
            url: 'https://linear.app/acme/issue/ENG-123#comment-xyz789',
            issueId: 'issue_abc123',
            userId: 'user_234',
            editedAt: '2025-11-06T13:05:00.000Z',
            createdAt: '2025-11-06T13:00:00.000Z',
            updatedAt: '2025-11-06T13:05:00.000Z',
            archivedAt: null,
          },
          updatedFrom: {
            body: 'I think we should also add support for Microsoft SSO in this implementation.',
            editedAt: null,
            updatedAt: '2025-11-06T13:00:00.000Z',
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
        value: 'linear_comment_updated',
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
