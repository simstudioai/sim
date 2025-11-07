import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCommentOutputs, jiraSetupInstructions } from './utils'

/**
 * Jira Issue Commented Trigger
 * Triggers when a comment is added to an issue
 */
export const jiraIssueCommentedTrigger: TriggerConfig = {
  id: 'jira_issue_commented',
  name: 'Jira Issue Commented',
  provider: 'jira',
  description: 'Trigger workflow when a comment is added to a Jira issue',
  version: '1.0.0',
  icon: JiraIcon,

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
        value: 'jira_issue_commented',
      },
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description: 'Optional secret to validate webhook deliveries from Jira using HMAC signature',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_commented',
      },
    },
    {
      id: 'jqlFilter',
      title: 'JQL Filter',
      type: 'long-input',
      placeholder: 'project = PROJ AND issuetype = Bug',
      description: 'Filter which issue comments trigger this workflow using JQL',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_commented',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: jiraSetupInstructions('comment_created'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_commented',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'jira_issue_commented',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_commented',
      },
    },
    {
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'code',
      language: 'json',
      defaultValue: JSON.stringify(
        {
          timestamp: 1234567890000,
          webhookEvent: 'comment_created',
          issue: {
            id: '10001',
            key: 'PROJ-123',
            self: 'https://your-domain.atlassian.net/rest/api/2/issue/10001',
            fields: {
              summary: 'Bug needs investigation',
              status: {
                name: 'In Progress',
                id: '10001',
                statusCategory: {
                  key: 'indeterminate',
                  name: 'In Progress',
                },
              },
              priority: {
                name: 'High',
                id: '2',
              },
              assignee: {
                displayName: 'John Doe',
                accountId: '557058:a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6',
                emailAddress: 'john.doe@example.com',
              },
              reporter: {
                displayName: 'Jane Smith',
                accountId: '557058:b2c3d4e5-6f7g-8h9i-0j1k-l2m3n4o5p6q7',
                emailAddress: 'jane.smith@example.com',
              },
              project: {
                key: 'PROJ',
                name: 'Project Name',
                id: '10000',
              },
              issuetype: {
                name: 'Bug',
                id: '10004',
              },
              created: '2024-01-15T10:30:00.000+0000',
              updated: '2024-01-15T15:45:00.000+0000',
              labels: ['backend', 'urgent'],
            },
          },
          comment: {
            id: '10050',
            body: 'I found the root cause. The issue is in the authentication service.',
            author: {
              displayName: 'John Doe',
              accountId: '557058:a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6',
              emailAddress: 'john.doe@example.com',
            },
            created: '2024-01-15T15:45:00.000+0000',
            updated: '2024-01-15T15:45:00.000+0000',
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
        value: 'jira_issue_commented',
      },
    },
  ],

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
