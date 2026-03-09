import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildConfluenceExtraFields,
  buildPageOutputs,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence Page Removed Trigger
 *
 * Triggers when a page is removed or trashed in Confluence.
 */
export const confluencePageRemovedTrigger: TriggerConfig = {
  id: 'confluence_page_removed',
  name: 'Confluence Page Removed',
  provider: 'confluence',
  description: 'Trigger workflow when a page is removed or trashed in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_page_removed',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('page_removed'),
    extraFields: buildConfluenceExtraFields('confluence_page_removed'),
  }),

  outputs: buildPageOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
