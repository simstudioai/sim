import { knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'

/**
 * Repository sources indexed through a GitHub installation, the only ones a GitHub grant
 * authorizes. The grant resolvers select only from these source conditions and candidate
 * discovery searches nowhere else, so discovery can never skip an authorizable source.
 */
export function githubInstallationSourceCondition(): SQL {
  return and(
    eq(knowledgeConnector.connectorType, 'github'),
    eq(knowledgeConnector.accessMode, 'members'),
    isNull(knowledgeConnector.archivedAt),
    isNull(knowledgeConnector.deletedAt),
    sql`${knowledgeConnector.sourceConfig}::jsonb ? 'githubRepositoryId'`
  )!
}

/** Central Confluence crawls, the only sources a Confluence site grant authorizes. */
export function confluenceSiteSourceCondition(): SQL {
  return and(
    eq(knowledgeConnector.connectorType, 'confluence'),
    eq(knowledgeConnector.accessMode, 'admin'),
    isNull(knowledgeConnector.archivedAt),
    isNull(knowledgeConnector.deletedAt)
  )!
}

/** Live knowledge bases within the resolved owner, narrowed to the operation's bases when given. */
export function liveSourceKnowledgeBaseCondition(
  scope: ResourceScope,
  knowledgeBaseIds: readonly string[] | undefined
): SQL {
  return and(
    resourceScopeCondition(knowledgeBase, scope),
    knowledgeBaseIds ? inArray(knowledgeBase.id, [...knowledgeBaseIds]) : undefined,
    isNull(knowledgeBase.deletedAt)
  )!
}
