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
      hideFromPreview: true,
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
      hideFromPreview: true,
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
