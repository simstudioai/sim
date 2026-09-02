import { document } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { KnowledgeAccessScope, SystemAccessScope } from '@/lib/knowledge/access/types'

/**
 * The single read-side access predicate: the document's ACL overlaps the
 * caller's token set. Tokens are bound as scalars and assembled with
 * `ARRAY[...]` because the shared pool runs with `fetch_types: false`, under
 * which a JS array bound as one parameter fails at execution (see
 * packages/db/db.ts). A literal array also keeps the planner's statistics on
 * `acl` usable, which is what lets it choose the GIN index for a selective set.
 *
 * The system scope is the only exemption and renders as `true`.
 */
export function knowledgeAccessCondition(scope: KnowledgeAccessScope | SystemAccessScope): SQL {
  if (scope.kind === 'system') return sql`true`
  if (scope.tokens.length === 0) return sql`false`
  return sql`${document.acl} && ARRAY[${sql.join(
    scope.tokens.map((token) => sql`${token}`),
    sql`, `
  )}]::text[]`
}
