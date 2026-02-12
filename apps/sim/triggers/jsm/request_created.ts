import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildRequestOutputs,
  jsmSetupInstructions,
  jsmTriggerOptions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Request Created Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 * Triggers when a new service request is created in Jira Service Management.
 */
export const jsmRequestCreatedTrigger: TriggerConfig = {
  id: 'jsm_request_created',
  name: 'JSM Request Created',
  provider: 'jira_service_management',
  description: 'Trigger workflow when a new service request is created',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: jsmTriggerOptions,
      value: () => 'jsm_request_created',
      required: true,
    },
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
        value: 'jsm_request_created',
      },
    },
    ...buildJsmExtraFields('jsm_request_created', { includeFileFields: false }),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_request_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('jira:issue_created'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_created',
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
