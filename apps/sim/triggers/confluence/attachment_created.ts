import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildAttachmentOutputs,
  buildConfluenceAttachmentExtraFields,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence Attachment Created Trigger
 *
 * Triggers when a new attachment is uploaded to a page or blog post in Confluence.
 */
export const confluenceAttachmentCreatedTrigger: TriggerConfig = {
  id: 'confluence_attachment_created',
  name: 'Confluence Attachment Created',
  provider: 'confluence',
  description: 'Trigger workflow when an attachment is uploaded in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_attachment_created',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('attachment_created'),
    extraFields: buildConfluenceAttachmentExtraFields('confluence_attachment_created'),
  }),

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
