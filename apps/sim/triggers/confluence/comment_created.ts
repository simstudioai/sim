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
 * Confluence Comment Created Trigger
 *
 * Triggers when a new comment is created on a page or blog post in Confluence.
 */
export const confluenceCommentCreatedTrigger: TriggerConfig = {
  id: 'confluence_comment_created',
  name: 'Confluence Comment Created',
  provider: 'confluence',
  description: 'Trigger workflow when a comment is created in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_comment_created',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('comment_created'),
    extraFields: buildConfluenceExtraFields('confluence_comment_created'),
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
