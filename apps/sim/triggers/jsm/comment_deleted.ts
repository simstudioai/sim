import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildJsmExtraFields,
  buildRequestCommentedOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Comment Deleted Trigger
 * Triggers when a comment is deleted from a service request
 */
export const jsmCommentDeletedTrigger: TriggerConfig = {
  id: 'jsm_comment_deleted',
  name: 'JSM Comment Deleted',
  provider: 'jira_service_management',
  description: 'Trigger workflow when a comment is deleted from a service request',
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
        value: 'jsm_comment_deleted',
      },
    },
    ...buildJsmExtraFields('jsm_comment_deleted', { includeFileFields: false }),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_comment_deleted',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_comment_deleted',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('comment_deleted'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_comment_deleted',
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
