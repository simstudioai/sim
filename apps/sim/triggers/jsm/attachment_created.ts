import { JiraServiceManagementIcon } from '@/components/icons'
import {
  buildAttachmentOutputs,
  buildJsmExtraFields,
  jsmSetupInstructions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Attachment Created Trigger
 * Triggers when an attachment is added to a service request
 */
export const jsmAttachmentCreatedTrigger: TriggerConfig = {
  id: 'jsm_attachment_created',
  name: 'JSM Attachment Created',
  provider: 'jira_service_management',
  description: 'Trigger workflow when an attachment is added to a service request',
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
        value: 'jsm_attachment_created',
      },
    },
    ...buildJsmExtraFields('jsm_attachment_created'),
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'jsm_attachment_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_attachment_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: jsmSetupInstructions('attachment_created'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'jsm_attachment_created',
      },
    },
  ],

  outputs: buildAttachmentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
