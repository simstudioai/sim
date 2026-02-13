import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildWorklogOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Worklog Created Trigger
 * Triggers when time is logged on a service request
 */
export const jsmWorklogCreatedTrigger: TriggerConfig = {
  id: 'jsm_worklog_created',
  name: 'JSM Worklog Created',
  provider: 'jira_service_management',
  description: 'Trigger workflow when time is logged on a service request',
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
        value: 'jsm_worklog_created',
      },
    },
    ...buildJsmExtraFields('jsm_worklog_created', { includeFileFields: false }),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_worklog_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_worklog_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('worklog_created'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_worklog_created',
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
