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
 * Confluence Page Restored Trigger
 *
 * Triggers when a page is restored from trash in Confluence.
 */
export const confluencePageRestoredTrigger: TriggerConfig = {
  id: 'confluence_page_restored',
  name: 'Confluence Page Restored',
  provider: 'confluence',
  description: 'Trigger workflow when a page is restored from trash in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_page_restored',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('page_restored'),
    extraFields: buildConfluenceExtraFields('confluence_page_restored'),
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
