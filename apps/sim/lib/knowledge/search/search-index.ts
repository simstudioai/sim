import { db } from '@sim/db'
import { knowledgeBase } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'

/** Resolves the single active Enterprise Search index owned by a workspace. */
export async function findSearchIndex(scope: ResourceScope) {
  const [index] = await db
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(
      and(
        resourceScopeCondition(knowledgeBase, scope),
        eq(knowledgeBase.isSearchIndex, true),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)
  return index ?? null
}

export function findWorkspaceSearchIndex(workspaceId: string) {
  return findSearchIndex({ kind: 'workspace', workspaceId })
}
