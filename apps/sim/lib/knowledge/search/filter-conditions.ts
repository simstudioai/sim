import { document, knowledgeConnector } from '@sim/db/schema'
import { eq, gte, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'

/** Filters the document in every retrieval leg, alongside its current ACL. */
export function workspaceSearchFilterConditions(filters?: WorkspaceSearchFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters?.documentIds) conditions.push(inArray(document.id, filters.documentIds))
  if (filters?.modifiedAfter) {
    conditions.push(gte(document.sourceModifiedAt, new Date(filters.modifiedAfter)))
  }
  if (filters?.modifiedBefore) {
    conditions.push(lte(document.sourceModifiedAt, new Date(filters.modifiedBefore)))
  }
  if (filters?.source === 'upload') conditions.push(isNull(document.connectorId))
  else if (filters?.source) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${knowledgeConnector} WHERE ${eq(knowledgeConnector.id, document.connectorId)} AND ${eq(knowledgeConnector.connectorType, filters.source)})`
    )
  }
  return conditions
}
