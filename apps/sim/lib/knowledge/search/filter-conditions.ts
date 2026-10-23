import { document, knowledgeConnector } from '@sim/db/schema'
import { and, eq, gte, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'

/** The date window a filter asks for, on the document row; nothing when none is asked. */
export function searchDateFilterCondition(filters?: WorkspaceSearchFilters): SQL | undefined {
  if (!filters?.modifiedAfter && !filters?.modifiedBefore) return undefined
  return and(
    filters.modifiedAfter
      ? gte(document.sourceModifiedAt, new Date(filters.modifiedAfter))
      : undefined,
    filters.modifiedBefore
      ? lte(document.sourceModifiedAt, new Date(filters.modifiedBefore))
      : undefined
  )
}

/** Filters the document in every retrieval leg, alongside its current ACL. */
export function workspaceSearchFilterConditions(filters?: WorkspaceSearchFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters?.documentIds) conditions.push(inArray(document.id, filters.documentIds))
  const dateCondition = searchDateFilterCondition(filters)
  if (dateCondition) conditions.push(dateCondition)
  if (filters?.source === 'upload') conditions.push(isNull(document.connectorId))
  else if (filters?.source) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${knowledgeConnector} WHERE ${eq(knowledgeConnector.id, document.connectorId)} AND ${eq(knowledgeConnector.connectorType, filters.source)})`
    )
  }
  return conditions
}
