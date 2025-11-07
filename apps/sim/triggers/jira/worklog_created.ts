import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildWorklogOutputs, jiraSetupInstructions, jiraWebhookSubBlocks } from './utils'

/**
 * Jira Worklog Created Trigger
 * Triggers when a worklog entry is added to an issue
 */
export const jiraWorklogCreatedTrigger: TriggerConfig = {
  id: 'jira_worklog_created',
  name: 'Jira Worklog Created',
  provider: 'jira',
  description:
    'Trigger workflow when time is logged on a Jira issue. Track time entries, sync with external systems, generate reports, or notify team leads.',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: [
        { label: 'Worklog Created', id: 'jira_worklog_created' },
        { label: 'Issue Created', id: 'jira_issue_created' },
        { label: 'Issue Updated', id: 'jira_issue_updated' },
        { label: 'Issue Deleted', id: 'jira_issue_deleted' },
        { label: 'Issue Commented', id: 'jira_issue_commented' },
        { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
      ],
      value: () => 'jira_worklog_created',
      required: true,
    },
    ...jiraWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_worklog_created',
      },
    })),
    {
      id: 'jqlFilter',
      title: 'JQL Filter (Optional)',
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
