import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, jiraSetupInstructions, jiraWebhookSubBlocks } from './utils'

/**
 * Jira Issue Updated Trigger
 * Triggers when an existing issue is updated in Jira
 */
export const jiraIssueUpdatedTrigger: TriggerConfig = {
  id: 'jira_issue_updated',
  name: 'Jira Issue Updated',
  provider: 'jira',
  description:
    'Trigger workflow when an issue is updated in Jira. Includes status, assignee, priority changes with detailed changelog data.',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: [
        { label: 'Issue Updated', id: 'jira_issue_updated' },
        { label: 'Issue Created', id: 'jira_issue_created' },
        { label: 'Issue Deleted', id: 'jira_issue_deleted' },
        { label: 'Issue Commented', id: 'jira_issue_commented' },
        { label: 'Worklog Created', id: 'jira_worklog_created' },
        { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
      ],
      value: () => 'jira_issue_updated',
      required: true,
    },
    ...jiraWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_updated',
      },
    })),
    {
      id: 'jqlFilter',
      title: 'JQL Filter (Optional)',
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
      title: 'Field Filters (Optional)',
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
