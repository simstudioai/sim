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
 * Jira Worklog Deleted Trigger
 * Triggers when a worklog entry is deleted from an issue
 */
export const jiraWorklogDeletedTrigger: TriggerConfig = {
  id: 'jira_worklog_deleted',
  name: 'Jira Worklog Deleted',
  provider: 'jira',
  description: 'Trigger workflow when a worklog entry is deleted from a Jira issue',
  version: '1.0.0',
  icon: JiraIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_worklog_deleted',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('worklog_deleted'),
    extraFields: buildJiraExtraFields(
      'jira_worklog_deleted',
      'Filter which worklog deletions trigger this workflow using JQL'
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
