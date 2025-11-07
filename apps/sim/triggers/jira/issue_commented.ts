import { JiraIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildCommentOutputs, jiraSetupInstructions, jiraWebhookSubBlocks } from './utils'

/**
 * Jira Issue Commented Trigger
 * Triggers when a comment is added to an issue
 */
export const jiraIssueCommentedTrigger: TriggerConfig = {
  id: 'jira_issue_commented',
  name: 'Jira Issue Commented',
  provider: 'jira',
  description:
    'Trigger workflow when a comment is added to a Jira issue. Notify team members, analyze sentiment, extract action items, or sync comments to external systems.',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: [
        { label: 'Issue Commented', id: 'jira_issue_commented' },
        { label: 'Issue Created', id: 'jira_issue_created' },
        { label: 'Issue Updated', id: 'jira_issue_updated' },
        { label: 'Issue Deleted', id: 'jira_issue_deleted' },
        { label: 'Worklog Created', id: 'jira_worklog_created' },
        { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
      ],
      value: () => 'jira_issue_commented',
      required: true,
    },
    ...jiraWebhookSubBlocks.map((block) => ({
      ...block,
      condition: {
        field: 'selectedTriggerId',
        value: 'jira_issue_commented',
      },
    })),
    {
      id: 'jqlFilter',
      title: 'JQL Filter (Optional)',
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
