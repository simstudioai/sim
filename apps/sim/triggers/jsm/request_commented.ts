import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildRequestCommentedOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Request Commented Trigger
 * Triggers when a comment is added to a service request
 */
export const jsmRequestCommentedTrigger: TriggerConfig = {
  id: 'jsm_request_commented',
  name: 'JSM Request Commented',
  provider: 'jira_service_management',
  description: 'Trigger workflow when a comment is added to a service request',
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
        value: 'jsm_request_commented',
      },
    },
    ...buildJsmExtraFields('jsm_request_commented', { includeFileFields: false }),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_request_commented',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_commented',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('comment_created'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_request_commented',
      },
    },
  ],

  outputs: buildRequestCommentedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
