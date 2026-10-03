import { document, knowledgeConnector } from '@sim/db/schema'
import { sql } from 'drizzle-orm'

/** A removed source hides its documents immediately, before permanent cleanup catches up. */
export function documentConnectorIsActive() {
  return sql`(${document.connectorId} IS NULL OR EXISTS (
    SELECT 1 FROM ${knowledgeConnector}
    WHERE ${knowledgeConnector.id} = ${document.connectorId}
      AND ${knowledgeConnector.knowledgeBaseId} = ${document.knowledgeBaseId}
      AND ${knowledgeConnector.deletedAt} IS NULL
      AND ${knowledgeConnector.archivedAt} IS NULL
  ))`
}
