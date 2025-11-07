import { LinearIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, linearSetupInstructions, linearWebhookSubBlocks } from './utils'

export const linearIssueRemovedTrigger: TriggerConfig = {
  id: 'linear_issue_removed',
  name: 'Linear Issue Removed',
  provider: 'linear',
  description: 'Trigger workflow when an issue is removed/deleted in Linear',
  version: '1.0.0',
  icon: LinearIcon,

  subBlocks: [
    ...linearWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_issue_removed',
      },
    })),
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: linearSetupInstructions('Issue (remove)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_issue_removed',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'linear_issue_removed',
      condition: {
        field: 'selectedTriggerId',
        value: 'linear_issue_removed',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          action: 'remove',
          type: 'Issue',
          webhookId: '550e8400-e29b-41d4-a716-446655440000',
          webhookTimestamp: 1730937600000,
          organizationId: 'org_abc123',
          createdAt: '2025-11-06T15:00:00.000Z',
          actor: {
            id: 'user_123',
            type: 'user',
            name: 'John Doe',
          },
          data: {
            id: 'issue_abc123',
            title: 'Implement user authentication',
            description: 'Add OAuth2 authentication flow for user login with Google and GitHub',
            identifier: 'ENG-123',
            number: 123,
            priority: 1,
            estimate: 8,
            sortOrder: 1000.5,
            teamId: 'team_456',
            stateId: 'state_started',
            assigneeId: 'user_234',
            creatorId: 'user_123',
            projectId: 'project_567',
            cycleId: 'cycle_890',
            parentId: null,
            labelIds: ['label_111', 'label_222', 'label_333'],
            subscriberIds: ['user_123', 'user_234', 'user_345'],
            url: 'https://linear.app/acme/issue/ENG-123',
            branchName: 'eng-123-implement-user-authentication',
            customerTicketCount: 3,
            dueDate: '2025-11-15',
            snoozedUntilAt: null,
            archivedAt: '2025-11-06T15:00:00.000Z',
            canceledAt: null,
            completedAt: null,
            startedAt: '2025-11-06T12:30:00.000Z',
            triagedAt: '2025-11-06T12:00:00.000Z',
            createdAt: '2025-11-06T12:00:00.000Z',
            updatedAt: '2025-11-06T15:00:00.000Z',
            autoArchivedAt: null,
            autoClosedAt: null,
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
        value: 'linear_issue_removed',
      },
    },
  ],

  outputs: buildIssueOutputs(),

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
