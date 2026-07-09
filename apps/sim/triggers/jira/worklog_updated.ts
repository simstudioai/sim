import { JiraIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildJiraExtraFields,
  buildWorklogOutputs,
  jiraSetupInstructions,
  jiraTriggerOptions,
} from '@/triggers/jira/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Jira Worklog Updated Trigger
 * Triggers when a worklog entry is updated on an issue
 */
export const jiraWorklogUpdatedTrigger: TriggerConfig = {
  id: 'jira_worklog_updated',
  name: 'Jira Worklog Updated',
  provider: 'jira',
  description: 'Trigger workflow when a worklog entry is updated on a Jira issue',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_worklog_updated',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('worklog_updated'),
    extraFields: buildJiraExtraFields(
      'jira_worklog_updated',
      'Filter which worklog updates trigger this workflow using JQL'
    ),
  }),

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
