import {
  executionLargeValueDependencies,
  executionLargeValueReferences,
  executionLargeValues,
} from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { BoundedCleanup } from '@/lib/cleanup/bounded'
import type { CleanupType } from '@/lib/cleanup/bounded-types'
import {
  largeValueTombstonePredicate,
  staleLargeValueDependencyPredicate,
  staleLargeValueReferencePredicate,
} from '@/lib/execution/payloads/large-value-metadata'

/** Stable primary-key identities survive updates between selection and deletion; never retain ctid across transactions. */

export async function pruneBoundedLargeValueMetadata(
  control: BoundedCleanup,
  workspaceIds: string[]
) {
  if (workspaceIds.length === 0) return
  const targets: {
    type: CleanupType
    from: SQL
    identity: SQL
    predicate: SQL
    exact: (id: string) => SQL
  }[] = [
    {
      type: 'staleReferences',
      exact: (id) => {
        const [key, executionId, source] = JSON.parse(id) as [string, string, string]
        return sql`ref.key = ${key} AND ref.execution_id = ${executionId} AND ref.source = ${source}`
      },
      from: sql`${executionLargeValueReferences} AS ref`,
      identity: sql`jsonb_build_array(ref.key, ref.execution_id, ref.source)::text`,
      predicate: sql`ref.workspace_id IN ${workspaceIds} AND ${staleLargeValueReferencePredicate()}`,
    },
    {
      type: 'staleDependencies',
      exact: (id) => {
        const [parentKey, childKey] = JSON.parse(id) as [string, string]
        return sql`dependency.parent_key = ${parentKey} AND dependency.child_key = ${childKey}`
      },
      from: sql`${executionLargeValueDependencies} AS dependency`,
      identity: sql`jsonb_build_array(dependency.parent_key, dependency.child_key)::text`,
      predicate: sql`dependency.workspace_id IN ${workspaceIds} AND ${staleLargeValueDependencyPredicate()}`,
    },
    {
      type: 'largeValueTombstones',
      exact: (id) => sql`value.key = ${id}`,
      from: sql`${executionLargeValues} AS value`,
      identity: sql`value.key`,
      predicate: sql`value.workspace_id IN ${workspaceIds} AND ${largeValueTombstonePredicate(new Date(Date.now() - 30 * 86400_000))}`,
    },
  ]
  for (const target of targets) {
    await control.batches(
      target.type,
      (limit, seen) =>
        control.query(async (tx) => {
          const rows = await tx.execute<{
            id: string
          }>(sql`SELECT ${target.identity} AS id FROM ${target.from}
          WHERE ${target.predicate} ${seen.length ? sql`AND ${target.identity} NOT IN ${seen}` : sql``}
          LIMIT ${limit}`)
          return [...rows]
        }),
      (row) => row.id,
      async (rows) => {
        const deleted = await control.query(async (tx) =>
          tx.execute(sql`DELETE FROM ${target.from}
          WHERE ${target.predicate} AND (${sql.join(
            rows.map((row) => sql`(${target.exact(row.id)})`),
            sql` OR `
          )}) RETURNING ${target.identity}`)
        )
        await control.deleted(target.type, deleted.length)
      }
    )
  }
}
