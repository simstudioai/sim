import { NotionIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildDatabaseEventOutputs,
  buildNotionExtraFields,
  notionSetupInstructions,
  notionTriggerOptions,
} from '@/triggers/notion/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Notion Database Created Trigger
 */
export const notionDatabaseCreatedTrigger: TriggerConfig = {
  id: 'notion_database_created',
  name: 'Notion Database Created',
  provider: 'notion',
  description: 'Trigger workflow when a new database is created in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_database_created',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('database.created'),
    extraFields: buildNotionExtraFields('notion_database_created'),
  }),

  outputs: buildDatabaseEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Notion-Signature': 'sha256=...',
    },
  },
}
