import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, jiraSetupInstructions } from './utils'

/**
 * Generic Jira Webhook Trigger
 * Captures all Jira webhook events
 */
export const jiraWebhookTrigger: TriggerConfig = {
  id: 'jira_webhook',
  name: 'Jira Webhook (All Events)',
  provider: 'jira',
  description: 'Trigger workflow on any Jira webhook event',
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
        value: 'jira_webhook',
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
        value: 'jira_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: jiraSetupInstructions('All Events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_webhook',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'jira_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_webhook',
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
          webhookEvent: 'jira:issue_created',
          issue_event_type_name: 'issue_created',
          issue: {
            id: '10001',
            key: 'PROJ-123',
            self: 'https://your-domain.atlassian.net/rest/api/2/issue/10001',
            fields: {
              summary: 'Sample issue title',
              status: {
                name: 'To Do',
                id: '10000',
                statusCategory: {
                  key: 'new',
                  name: 'To Do',
                },
              },
              priority: {
                name: 'Medium',
                id: '3',
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
                name: 'Task',
                id: '10002',
              },
              created: '2024-01-15T10:30:00.000+0000',
              updated: '2024-01-15T10:30:00.000+0000',
              labels: ['backend', 'bug'],
            },
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
        value: 'jira_webhook',
      },
    },
  ],

  outputs: {
    ...buildIssueOutputs(),
    changelog: {
      id: {
        type: 'string',
        description: 'Changelog ID',
      },
      items: {
        type: 'array',
        description:
          'Array of changed items. Each item contains field, fieldtype, from, fromString, to, toString',
      },
    },
    comment: {
      id: {
        type: 'string',
        description: 'Comment ID',
      },
      body: {
        type: 'string',
        description: 'Comment text/body',
      },
      author: {
        displayName: {
          type: 'string',
          description: 'Comment author display name',
        },
        accountId: {
          type: 'string',
          description: 'Comment author account ID',
        },
        emailAddress: {
          type: 'string',
          description: 'Comment author email address',
        },
      },
      created: {
        type: 'string',
        description: 'Comment creation date (ISO format)',
      },
      updated: {
        type: 'string',
        description: 'Comment last updated date (ISO format)',
      },
    },
    worklog: {
      id: {
        type: 'string',
        description: 'Worklog entry ID',
      },
      author: {
        displayName: {
          type: 'string',
          description: 'Worklog author display name',
        },
        accountId: {
          type: 'string',
          description: 'Worklog author account ID',
        },
        emailAddress: {
          type: 'string',
          description: 'Worklog author email address',
        },
      },
      timeSpent: {
        type: 'string',
        description: 'Time spent (e.g., "2h 30m")',
      },
      timeSpentSeconds: {
        type: 'number',
        description: 'Time spent in seconds',
      },
      comment: {
        type: 'string',
        description: 'Worklog comment/description',
      },
      started: {
        type: 'string',
        description: 'When the work was started (ISO format)',
      },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
