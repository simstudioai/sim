import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildIssueOutputs, jiraSetupInstructions, jiraWebhookSubBlocks } from './utils'

/**
 * Jira Issue Deleted Trigger
 * Triggers when an issue is deleted in Jira
 */
export const jiraIssueDeletedTrigger: TriggerConfig = {
  id: 'jira_issue_deleted',
  name: 'Jira Issue Deleted',
  provider: 'jira',
  description:
    'Trigger workflow when an issue is deleted in Jira. Clean up related data, notify stakeholders, or sync deletions with external systems.',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: [
        { label: 'Issue Deleted', id: 'jira_issue_deleted' },
        { label: 'Issue Created', id: 'jira_issue_created' },
        { label: 'Issue Updated', id: 'jira_issue_updated' },
        { label: 'Issue Commented', id: 'jira_issue_commented' },
        { label: 'Worklog Created', id: 'jira_worklog_created' },
        { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
      ],
      value: () => 'jira_issue_deleted',
      required: true,
    },
    ...jiraWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_deleted',
      },
    })),
    {
      id: 'jqlFilter',
      title: 'JQL Filter (Optional)',
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
