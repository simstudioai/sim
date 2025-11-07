import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildWorklogOutputs, jiraSetupInstructions } from './utils'

/**
 * Jira Worklog Created Trigger
 * Triggers when a worklog entry is added to an issue
 */
export const jiraWorklogCreatedTrigger: TriggerConfig = {
  id: 'jira_worklog_created',
  name: 'Jira Worklog Created',
  provider: 'jira',
  description: 'Trigger workflow when time is logged on a Jira issue',
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
        value: 'jira_worklog_created',
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
        value: 'jira_worklog_created',
      },
    },
    {
      id: 'jqlFilter',
      title: 'JQL Filter',
      type: 'long-input',
      placeholder: 'project = PROJ',
      description: 'Filter which worklog entries trigger this workflow using JQL',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_worklog_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: jiraSetupInstructions('worklog_created'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_worklog_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'jira_worklog_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_worklog_created',
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
          webhookEvent: 'worklog_created',
          issue: {
            id: '10001',
            key: 'PROJ-123',
            self: 'https://your-domain.atlassian.net/rest/api/2/issue/10001',
            fields: {
              summary: 'Implement new feature',
              status: {
                name: 'In Progress',
                id: '10001',
                statusCategory: {
                  key: 'indeterminate',
                  name: 'In Progress',
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
              updated: '2024-01-15T16:20:00.000+0000',
              labels: ['feature', 'sprint-1'],
            },
          },
          worklog: {
            id: '10200',
            author: {
              displayName: 'John Doe',
              accountId: '557058:a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6',
              emailAddress: 'john.doe@example.com',
            },
            timeSpent: '3h 30m',
            timeSpentSeconds: 12600,
            comment: 'Completed initial implementation and testing',
            started: '2024-01-15T13:00:00.000+0000',
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
        value: 'jira_worklog_created',
      },
    },
  ],

  outputs: buildWorklogOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
