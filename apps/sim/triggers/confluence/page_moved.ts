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
 * Confluence Page Moved Trigger
 *
 * Triggers when a page is moved to a different space or parent in Confluence.
 */
export const confluencePageMovedTrigger: TriggerConfig = {
  id: 'confluence_page_moved',
  name: 'Confluence Page Moved',
  provider: 'confluence',
  description: 'Trigger workflow when a page is moved in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_page_moved',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('page_moved'),
    extraFields: buildConfluenceExtraFields('confluence_page_moved'),
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
