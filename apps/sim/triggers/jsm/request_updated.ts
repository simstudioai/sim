import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildRequestUpdatedOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Request Updated Trigger
 * Triggers when a service request is updated in Jira Service Management
 */
export const jsmRequestUpdatedTrigger: TriggerConfig = {
  id: 'jsm_request_updated',
  name: 'JSM Request Updated',
  provider: 'jira_service_management',
  description: 'Trigger workflow when a service request is updated',
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
        value: 'jsm_request_updated',
      },
    },
    ...buildJsmExtraFields('jsm_request_updated', { includeFileFields: false }),
    {
      id: 'fieldFilters',
      title: 'Field Filters',
      type: 'long-input',
      placeholder: 'status, assignee, priority',
      description:
        'Comma-separated list of fields to monitor. Only trigger when these fields change.',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_updated',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_request_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('jira:issue_updated'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_updated',
      },
    },
  ],

  outputs: buildRequestUpdatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
