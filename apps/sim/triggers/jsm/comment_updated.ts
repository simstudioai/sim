import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildRequestCommentedOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Comment Updated Trigger
 * Triggers when a comment is updated on a service request
 */
export const jsmCommentUpdatedTrigger: TriggerConfig = {
  id: 'jsm_comment_updated',
  name: 'JSM Comment Updated',
  provider: 'jira_service_management',
  description: 'Trigger workflow when a comment is updated on a service request',
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
        value: 'jsm_comment_updated',
      },
    },
    ...buildJsmExtraFields('jsm_comment_updated', { includeFileFields: false }),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_comment_updated',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_comment_updated',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('comment_updated'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_comment_updated',
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
