import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildWorklogOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Worklog Updated Trigger
 * Triggers when a worklog entry is updated on a service request
 */
export const jsmWorklogUpdatedTrigger: TriggerConfig = {
  id: 'jsm_worklog_updated',
  name: 'JSM Worklog Updated',
  provider: 'jira_service_management',
  description: 'Trigger workflow when a worklog entry is updated on a service request',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

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
        value: 'jsm_worklog_updated',
      },
    },
    ...buildJsmExtraFields('jsm_worklog_updated', { includeFileFields: false }),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_worklog_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_worklog_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('worklog_updated'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_worklog_updated',
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
