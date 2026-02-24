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
 * Confluence Attachment Removed Trigger
 *
 * Triggers when an attachment is removed or trashed from a page or blog post in Confluence.
 */
export const confluenceAttachmentRemovedTrigger: TriggerConfig = {
  id: 'confluence_attachment_removed',
  name: 'Confluence Attachment Removed',
  provider: 'confluence',
  description: 'Trigger workflow when an attachment is removed in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_attachment_removed',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('attachment_removed'),
    extraFields: buildConfluenceAttachmentExtraFields('confluence_attachment_removed'),
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
