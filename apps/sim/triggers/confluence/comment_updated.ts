import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildCommentOutputs,
  buildConfluenceExtraFields,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence Comment Updated Trigger
 *
 * Triggers when a comment on a page or blog post is updated/edited in Confluence.
 */
export const confluenceCommentUpdatedTrigger: TriggerConfig = {
  id: 'confluence_comment_updated',
  name: 'Confluence Comment Updated',
  provider: 'confluence',
  description: 'Trigger workflow when a comment is updated in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_comment_updated',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('comment_updated'),
    extraFields: buildConfluenceExtraFields('confluence_comment_updated'),
  }),

  outputs: buildCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
