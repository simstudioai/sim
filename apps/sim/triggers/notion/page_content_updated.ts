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
 * Notion Page Content Updated Trigger
 *
 * Fires when page content changes. High-frequency events may be batched.
 */
export const notionPageContentUpdatedTrigger: TriggerConfig = {
  id: 'notion_page_content_updated',
  name: 'Notion Page Content Updated',
  provider: 'notion',
  description: 'Trigger workflow when page content is changed in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_page_content_updated',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('page.content_updated'),
    extraFields: buildNotionExtraFields('notion_page_content_updated'),
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
