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
 * Confluence Blog Post Created Trigger
 *
 * Triggers when a new blog post is created in Confluence.
 */
export const confluenceBlogCreatedTrigger: TriggerConfig = {
  id: 'confluence_blog_created',
  name: 'Confluence Blog Post Created',
  provider: 'confluence',
  description: 'Trigger workflow when a blog post is created in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_blog_created',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('blog_created'),
    extraFields: buildConfluenceExtraFields('confluence_blog_created'),
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
