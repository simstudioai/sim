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
 * Confluence Page Updated Trigger
 *
 * Triggers when an existing page is updated in Confluence.
 */
export const confluencePageUpdatedTrigger: TriggerConfig = {
  id: 'confluence_page_updated',
  name: 'Confluence Page Updated',
  provider: 'confluence',
  description: 'Trigger workflow when a page is updated in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_page_updated',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('page_updated'),
    extraFields: buildConfluenceExtraFields('confluence_page_updated'),
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
