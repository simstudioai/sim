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
 * Confluence Page Created Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 * Triggers when a new page is created in Confluence.
 */
export const confluencePageCreatedTrigger: TriggerConfig = {
  id: 'confluence_page_created',
  name: 'Confluence Page Created',
  provider: 'confluence',
  description: 'Trigger workflow when a new page is created in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_page_created',
    triggerOptions: confluenceTriggerOptions,
    includeDropdown: true,
    setupInstructions: confluenceSetupInstructions('page_created'),
    extraFields: buildConfluenceExtraFields('confluence_page_created'),
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
