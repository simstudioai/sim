import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, jiraSetupInstructions, jiraWebhookSubBlocks } from './utils'

/**
 * Jira Issue Created Trigger
 * Triggers when a new issue is created in Jira
 */
export const jiraIssueCreatedTrigger: TriggerConfig = {
  id: 'jira_issue_created',
  name: 'Jira Issue Created',
  provider: 'jira',
  description:
    'Trigger workflow when a new issue is created in Jira. Automate notifications, create related tasks, or update external systems.',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: [
        { label: 'Issue Created', id: 'jira_issue_created' },
        { label: 'Issue Updated', id: 'jira_issue_updated' },
        { label: 'Issue Deleted', id: 'jira_issue_deleted' },
        { label: 'Issue Commented', id: 'jira_issue_commented' },
        { label: 'Worklog Created', id: 'jira_worklog_created' },
        { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
      ],
      value: () => 'jira_issue_created',
      required: true,
    },
    ...jiraWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_created',
      },
    })),
    {
      id: 'jqlFilter',
      title: 'JQL Filter (Optional)',
      type: 'long-input',
      placeholder: 'project = PROJ AND issuetype = Bug',
      description: 'Filter which issues trigger this workflow using JQL (Jira Query Language)',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: jiraSetupInstructions('jira:issue_created'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      mode: 'trigger',
      triggerId: 'jira_issue_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_created',
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
