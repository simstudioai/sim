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
 * Confluence Blog Post Restored Trigger
 *
 * Triggers when a blog post is restored from trash in Confluence.
 */
export const confluenceBlogRestoredTrigger: TriggerConfig = {
  id: 'confluence_blog_restored',
  name: 'Confluence Blog Post Restored',
  provider: 'confluence',
  description: 'Trigger workflow when a blog post is restored from trash in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_blog_restored',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('blog_restored'),
    extraFields: buildConfluenceExtraFields('confluence_blog_restored'),
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
