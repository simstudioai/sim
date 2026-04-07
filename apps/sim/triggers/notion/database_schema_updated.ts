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
 * Notion Database Schema Updated Trigger
 *
 * Fires when a database schema (properties/columns) is modified.
 */
export const notionDatabaseSchemaUpdatedTrigger: TriggerConfig = {
  id: 'notion_database_schema_updated',
  name: 'Notion Database Schema Updated',
  provider: 'notion',
  description: 'Trigger workflow when a database schema is modified in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_database_schema_updated',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('database.schema_updated'),
    extraFields: buildNotionExtraFields('notion_database_schema_updated'),
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
