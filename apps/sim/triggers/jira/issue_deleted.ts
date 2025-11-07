import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, jiraSetupInstructions } from './utils'

/**
 * Jira Issue Deleted Trigger
 * Triggers when an issue is deleted in Jira
 */
export const jiraIssueDeletedTrigger: TriggerConfig = {
  id: 'jira_issue_deleted',
  name: 'Jira Issue Deleted',
  provider: 'jira',
  description: 'Trigger workflow when an issue is deleted in Jira',
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
        value: 'jira_issue_deleted',
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
        value: 'jira_issue_deleted',
      },
    },
    {
      id: 'jqlFilter',
      title: 'JQL Filter',
      type: 'long-input',
      placeholder: 'project = PROJ',
      description: 'Filter which issue deletions trigger this workflow using JQL',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_deleted',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: jiraSetupInstructions('jira:issue_deleted'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_deleted',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'jira_issue_deleted',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_deleted',
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
          webhookEvent: 'jira:issue_deleted',
          issue_event_type_name: 'issue_deleted',
          issue: {
            id: '10001',
            key: 'PROJ-123',
            self: 'https://your-domain.atlassian.net/rest/api/2/issue/10001',
            fields: {
              summary: 'Duplicate issue - deleted',
              status: {
                name: 'Done',
                id: '10002',
                statusCategory: {
                  key: 'done',
                  name: 'Done',
                },
              },
              priority: {
                name: 'Low',
                id: '4',
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
              updated: '2024-01-15T17:00:00.000+0000',
              labels: ['duplicate'],
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
        value: 'jira_issue_deleted',
      },
    },
  ],

  outputs: buildIssueOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
