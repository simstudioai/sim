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

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jira_worklog_created',
    triggerOptions: jiraTriggerOptions,
    setupInstructions: jiraSetupInstructions('worklog_created'),
    extraFields: buildJiraExtraFields(
      'jira_worklog_created',
      'Filter which worklog entries trigger this workflow using JQL'
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
