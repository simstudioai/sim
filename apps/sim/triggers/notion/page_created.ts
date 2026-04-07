import { NotionIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildNotionExtraFields,
  buildPageEventOutputs,
  notionSetupInstructions,
  notionTriggerOptions,
} from '@/triggers/notion/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Notion Page Created Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 */
export const notionPageCreatedTrigger: TriggerConfig = {
  id: 'notion_page_created',
  name: 'Notion Page Created',
  provider: 'notion',
  description: 'Trigger workflow when a new page is created in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_page_created',
    triggerOptions: notionTriggerOptions,
    includeDropdown: true,
    setupInstructions: notionSetupInstructions('page.created'),
    extraFields: buildNotionExtraFields('notion_page_created'),
  }),

  outputs: buildPageEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Notion-Signature': 'sha256=...',
    },
  },
}
