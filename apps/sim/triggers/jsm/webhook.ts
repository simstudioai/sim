import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildAttachmentOutputs,
  buildJsmExtraFields,
  buildRequestCommentedOutputs,
  buildRequestOutputs,
  buildWorklogOutputs,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic JSM Webhook Trigger
 * Captures all Jira Service Management webhook events
 */
export const jsmWebhookTrigger: TriggerConfig = {
  id: 'jsm_webhook',
  name: 'JSM Webhook (All Events)',
  provider: 'jira_service_management',
  description: 'Trigger workflow on any Jira Service Management webhook event',
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
        value: 'jsm_webhook',
      },
    },
    ...buildJsmExtraFields('jsm_webhook'),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_webhook',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_webhook',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('All Events'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_webhook',
      },
    },
  ],

  outputs: {
    ...buildRequestOutputs(),
    changelog: {
      id: {
        type: 'string',
        description: 'Changelog ID',
      },
      items: {
        type: 'array',
        description:
          'Array of changed items. Each item contains field, fieldtype, from, fromString, to, toString',
      },
    },
    ...(() => {
      const commentOutputs = buildRequestCommentedOutputs()
      return { comment: commentOutputs.comment }
    })(),
    ...(() => {
      const worklogOutputs = buildWorklogOutputs()
      return { worklog: worklogOutputs.worklog }
    })(),
    ...(() => {
      const attachmentOutputs = buildAttachmentOutputs()
      return {
        attachment: attachmentOutputs.attachment,
        files: attachmentOutputs.files,
      }
    })(),
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
