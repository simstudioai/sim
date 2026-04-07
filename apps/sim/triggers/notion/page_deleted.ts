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
 * Notion Page Deleted Trigger
 */
export const notionPageDeletedTrigger: TriggerConfig = {
  id: 'notion_page_deleted',
  name: 'Notion Page Deleted',
  provider: 'notion',
  description: 'Trigger workflow when a page is deleted in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_page_deleted',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('page.deleted'),
    extraFields: buildNotionExtraFields('notion_page_deleted'),
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
