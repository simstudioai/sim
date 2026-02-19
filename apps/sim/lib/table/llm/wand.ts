/**
 * Wand enricher for table schema context.
 */

import { db } from '@sim/db'
import { userTableDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import type { TableSchema } from '../types'

const logger = createLogger('TableWandEnricher')

/**
 * Wand enricher that provides table schema context.
 * Used by the wand API to inject table column information into the system prompt.
 */
export async function enrichTableSchema(
  workspaceId: string | null,
  context: Record<string, unknown>
): Promise<string | null> {
  const tableId = context.tableId as string | undefined
  if (!tableId || !workspaceId) {
    return null
  }

  try {
    const [table] = await db
      .select({
        name: userTableDefinitions.name,
        schema: userTableDefinitions.schema,
      })
      .from(userTableDefinitions)
      .where(
        and(eq(userTableDefinitions.id, tableId), eq(userTableDefinitions.workspaceId, workspaceId))
      )
      .limit(1)

    if (!table) {
      return null
    }

    const schema = table.schema as TableSchema | null
    if (!schema?.columns?.length) {
      return null
    }

    const columnLines = schema.columns
      .map((col) => {
        const flags = [col.type, col.required && 'required', col.unique && 'unique'].filter(Boolean)
        return `- ${col.name} (${flags.join(', ')})`
      })
      .join('\n')

    const label = table.name ? `${table.name} (${tableId})` : tableId
    return `Table schema for ${label}:\n${columnLines}\nBuilt-in columns: createdAt, updatedAt`
  } catch (error) {
    logger.debug('Failed to fetch table schema', { tableId, error })
    return null
  }
}
