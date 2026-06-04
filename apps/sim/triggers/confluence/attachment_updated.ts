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
 * Confluence Attachment Updated Trigger
 *
 * Triggers when an attachment is updated (new version uploaded) in Confluence.
 */
export const confluenceAttachmentUpdatedTrigger: TriggerConfig = {
  id: 'confluence_attachment_updated',
  name: 'Confluence Attachment Updated',
  provider: 'confluence',
  description: 'Trigger workflow when an attachment is updated in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_attachment_updated',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('attachment_updated'),
    extraFields: buildConfluenceAttachmentExtraFields('confluence_attachment_updated'),
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
