import { and, eq, isNull, or } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import type { ResourceScope } from '@/lib/core/resource-scope'

/** Constrains both owner columns so malformed dual-owned rows cannot cross scopes. */
export function resourceScopeCondition(
  table: { workspaceId: PgColumn; organizationId: PgColumn },
  scope: ResourceScope
) {
  return scope.kind === 'workspace'
    ? and(eq(table.workspaceId, scope.workspaceId), isNull(table.organizationId))!
    : and(eq(table.organizationId, scope.organizationId), isNull(table.workspaceId))!
}

/** Joins resources only when both have the same unambiguous owner. */
export function sameResourceScopeCondition(
  left: { workspaceId: PgColumn; organizationId: PgColumn },
  right: { workspaceId: PgColumn; organizationId: PgColumn }
) {
  return or(
    and(
      eq(left.workspaceId, right.workspaceId),
      isNull(left.organizationId),
      isNull(right.organizationId)
    ),
    and(
      eq(left.organizationId, right.organizationId),
      isNull(left.workspaceId),
      isNull(right.workspaceId)
    )
  )!
}
