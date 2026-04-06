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
 * Notion Database Deleted Trigger
 */
export const notionDatabaseDeletedTrigger: TriggerConfig = {
  id: 'notion_database_deleted',
  name: 'Notion Database Deleted',
  provider: 'notion',
  description: 'Trigger workflow when a database is deleted in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_database_deleted',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('database.deleted'),
    extraFields: buildNotionExtraFields('notion_database_deleted'),
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
