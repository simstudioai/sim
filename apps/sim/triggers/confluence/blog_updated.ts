import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildBlogOutputs,
  buildConfluenceExtraFields,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence Blog Post Updated Trigger
 *
 * Triggers when a blog post is updated in Confluence.
 */
export const confluenceBlogUpdatedTrigger: TriggerConfig = {
  id: 'confluence_blog_updated',
  name: 'Confluence Blog Post Updated',
  provider: 'confluence',
  description: 'Trigger workflow when a blog post is updated in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_blog_updated',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('blog_updated'),
    extraFields: buildConfluenceExtraFields('confluence_blog_updated'),
  }),

  outputs: buildBlogOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
