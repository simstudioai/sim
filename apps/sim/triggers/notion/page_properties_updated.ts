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
 * Notion Page Properties Updated Trigger
 *
 * Fires when page properties (title, status, tags, etc.) are modified.
 */
export const notionPagePropertiesUpdatedTrigger: TriggerConfig = {
  id: 'notion_page_properties_updated',
  name: 'Notion Page Properties Updated',
  provider: 'notion',
  description: 'Trigger workflow when page properties are modified in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_page_properties_updated',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('page.properties_updated'),
    extraFields: buildNotionExtraFields('notion_page_properties_updated'),
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
