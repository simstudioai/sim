import { and, eq, isNull } from 'drizzle-orm'
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
