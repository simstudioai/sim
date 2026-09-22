import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import {
  ACTIVE_KNOWLEDGE_BASE_REFERENCE_FIELDS,
  type ActiveKnowledgeBaseReference,
  toActiveKnowledgeBaseReference,
} from '@/lib/knowledge/knowledge-base-reference'

/**
 * Resolves the single active Enterprise Search index owned by a workspace or organization, as
 * the reference a search runs over, so the caller that found it need not read it again.
 */
export async function findSearchIndex(
  scope: ResourceScope
): Promise<ActiveKnowledgeBaseReference | null> {
  const [index] = await db
    .select(ACTIVE_KNOWLEDGE_BASE_REFERENCE_FIELDS)
    .from(knowledgeBase)
    .where(
      and(
        resourceScopeCondition(knowledgeBase, scope),
        eq(knowledgeBase.isSearchIndex, true),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)
  return index ? toActiveKnowledgeBaseReference(index) : null
}

export function findWorkspaceSearchIndex(workspaceId: string) {
  return findSearchIndex({ kind: 'workspace', workspaceId })
}
