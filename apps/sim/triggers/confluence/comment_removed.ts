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
 * Confluence Comment Removed Trigger
 *
 * Triggers when a comment is removed from a page or blog post in Confluence.
 */
export const confluenceCommentRemovedTrigger: TriggerConfig = {
  id: 'confluence_comment_removed',
  name: 'Confluence Comment Removed',
  provider: 'confluence',
  description: 'Trigger workflow when a comment is removed in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_comment_removed',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('comment_removed'),
    extraFields: buildConfluenceExtraFields('confluence_comment_removed'),
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
