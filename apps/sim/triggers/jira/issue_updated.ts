import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueUpdatedOutputs, jiraSetupInstructions } from './utils'

/**
 * Jira Issue Updated Trigger
 * Triggers when an existing issue is updated in Jira
 */
export const jiraIssueUpdatedTrigger: TriggerConfig = {
  id: 'jira_issue_updated',
  name: 'Jira Issue Updated',
  provider: 'jira',
  description: 'Trigger workflow when an issue is updated in Jira',
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
        value: 'jira_issue_updated',
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
        value: 'jira_issue_updated',
      },
    },
    {
      id: 'jqlFilter',
      title: 'JQL Filter',
      type: 'long-input',
      placeholder: 'project = PROJ AND status changed to "In Progress"',
      description: 'Filter which issue updates trigger this workflow using JQL',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_updated',
      },
    },
    {
      id: 'fieldFilters',
      title: 'Field Filters',
      type: 'long-input',
      placeholder: 'status, assignee, priority',
      description:
        'Comma-separated list of fields to monitor. Only trigger when these fields change.',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: jiraSetupInstructions('jira:issue_updated'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'jira_issue_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_updated',
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
          webhookEvent: 'jira:issue_updated',
          issue_event_type_name: 'issue_updated',
          issue: {
            id: '10001',
            key: 'PROJ-123',
            self: 'https://your-domain.atlassian.net/rest/api/2/issue/10001',
            fields: {
              summary: 'Bug fix in progress',
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
              updated: '2024-01-15T14:25:00.000+0000',
              labels: ['backend', 'urgent'],
            },
          },
          changelog: {
            id: '12345',
            items: [
              {
                field: 'status',
                fieldtype: 'jira',
                from: '10000',
                fromString: 'To Do',
                to: '10001',
                toString: 'In Progress',
              },
            ],
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
        value: 'jira_issue_updated',
      },
    },
  ],

  outputs: buildIssueUpdatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
