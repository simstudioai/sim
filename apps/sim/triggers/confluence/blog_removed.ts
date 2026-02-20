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
 * Confluence Blog Post Removed Trigger
 *
 * Triggers when a blog post is removed or trashed in Confluence.
 */
export const confluenceBlogRemovedTrigger: TriggerConfig = {
  id: 'confluence_blog_removed',
  name: 'Confluence Blog Post Removed',
  provider: 'confluence',
  description: 'Trigger workflow when a blog post is removed in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_blog_removed',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('blog_removed'),
    extraFields: buildConfluenceExtraFields('confluence_blog_removed'),
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
