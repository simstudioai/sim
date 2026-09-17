import { knowledgeExternalGroup, knowledgeExternalGroupMember } from '@sim/db/schema'
import { and, eq, gte, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { CONFLUENCE_SPACE_GROUP_PREFIX } from '@/lib/knowledge/access/confluence-space-groups'

/** A directory exceeding these read-side budgets fails closed instead of truncating access. */
export const MAX_EXTERNAL_GROUP_TOKENS = 100_000
const MAX_EXTERNAL_GROUP_TOKEN_BYTES = 16 * 1024 * 1024

export function assertExternalGroupTokenCapacity(tokens: readonly string[]): void {
  let bytes = 0
  for (const token of tokens) {
    bytes += Buffer.byteLength(token, 'utf8')
    if (bytes > MAX_EXTERNAL_GROUP_TOKEN_BYTES) {
      throw new Error('External group access exceeded its token byte capacity')
    }
  }
  if (tokens.length > MAX_EXTERNAL_GROUP_TOKENS) {
    throw new Error('External group access exceeded its token capacity')
  }
}

/** Match a document's audience first, then the same reader directly or through one native group. */
export function confluenceReaderGroupCondition(input: {
  readerSubjectToken: SQL
  cloudId: SQL
  organizationId: SQL
  workspaceId: SQL
  freshEnough: SQL
  hasToken: (token: SQL) => SQL
}): SQL {
  const group = knowledgeExternalGroup
  const member = knowledgeExternalGroupMember
  const native = alias(group, 'confluence_native_group')
  const nativeMember = alias(member, 'confluence_native_member')
  const audienceMember = alias(member, 'confluence_audience_member')
  const token = sql`('g:' || ${group.providerId} || ':' || ${group.tenantId} || ':' || ${group.externalGroupId})`
  return sql`
    EXISTS (
      SELECT 1 FROM ${group}
      WHERE ${group.providerId} = 'confluence'
        AND ${group.tenantId} = ${input.cloudId}
        AND ${group.organizationId} IS NOT DISTINCT FROM ${input.organizationId}
        AND ${group.workspaceId} IS NOT DISTINCT FROM ${input.workspaceId}
        AND ${group.lastSyncedAt} >= ${input.freshEnough}
        AND ${input.hasToken(token)}
        AND (
          EXISTS (
            SELECT 1 FROM ${member}
            WHERE ${member.groupId} = ${group.id}
              AND ${member.subjectToken} = ${input.readerSubjectToken}
          )
          OR (starts_with(${group.externalGroupId}, ${CONFLUENCE_SPACE_GROUP_PREFIX}) AND EXISTS (
            SELECT 1 FROM ${member} AS ${nativeMember}
            INNER JOIN ${group} AS ${native} ON ${native.id} = ${nativeMember.groupId}
            INNER JOIN ${member} AS ${audienceMember} ON ${audienceMember.groupId} = ${group.id}
              AND ${audienceMember.subjectToken} = 'g:confluence:' || ${native.tenantId} || ':' || ${native.externalGroupId}
            WHERE ${nativeMember.subjectToken} = ${input.readerSubjectToken}
              AND ${native.providerId} = 'confluence'
              AND ${native.tenantId} = ${input.cloudId}
              AND ${native.organizationId} IS NOT DISTINCT FROM ${input.organizationId}
              AND ${native.workspaceId} IS NOT DISTINCT FROM ${input.workspaceId}
              AND ${native.lastSyncedAt} >= ${input.freshEnough}
              AND NOT starts_with(${native.externalGroupId}, ${CONFLUENCE_SPACE_GROUP_PREFIX})
          ))
        )
    )
  `
}

export function parentGroupTokensQuery(
  tokens: readonly string[],
  scope: ResourceScope,
  freshEnough: Date
): SQL {
  const group = knowledgeExternalGroup
  const member = knowledgeExternalGroupMember
  return sql`
    SELECT DISTINCT 'g:' || ${group.providerId} || ':' || ${group.tenantId} || ':' || ${group.externalGroupId} AS token
    FROM ${group}
    INNER JOIN ${member} ON ${eq(member.groupId, group.id)}
    WHERE ${and(resourceScopeCondition(group, scope), gte(group.lastSyncedAt, freshEnough))}
      AND ${group.providerId} = 'confluence'
      AND starts_with(${group.externalGroupId}, ${CONFLUENCE_SPACE_GROUP_PREFIX})
      AND starts_with(${member.subjectToken}, 'g:confluence:' || ${group.tenantId} || ':')
      AND NOT starts_with(${member.subjectToken}, 'g:confluence:' || ${group.tenantId} || ':' || ${CONFLUENCE_SPACE_GROUP_PREFIX})
      AND ${member.subjectToken} IN (SELECT jsonb_array_elements_text(${JSON.stringify(tokens)}::text::jsonb))
    LIMIT ${MAX_EXTERNAL_GROUP_TOKENS + 1}
  `
}
