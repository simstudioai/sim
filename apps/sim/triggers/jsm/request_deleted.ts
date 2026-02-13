import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildRequestOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Request Deleted Trigger
 * Triggers when a service request is deleted in Jira Service Management
 */
export const jsmRequestDeletedTrigger: TriggerConfig = {
  id: 'jsm_request_deleted',
  name: 'JSM Request Deleted',
  provider: 'jira_service_management',
  description: 'Trigger workflow when a service request is deleted',
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
        value: 'jsm_request_deleted',
      },
    },
    ...buildJsmExtraFields('jsm_request_deleted', { includeFileFields: false }),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_request_deleted',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_deleted',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('jira:issue_deleted'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_deleted',
      },
    },
  ],

  outputs: buildRequestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
