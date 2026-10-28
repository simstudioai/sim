import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'

type SourceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Tests workspace ownership in SQL without loading the organization's workspace IDs. */
export function workspaceInOrganization(column: PgColumn, organizationId: string): SQL {
  return sql`exists (
    select 1 from ${workspace}
    where ${workspace.id} = ${column} and ${workspace.organizationId} = ${organizationId}
  )`
}

/** Measures database payloads before loading them, under the same immutable read snapshot. */
export async function readBoundedSourcePage<TRow>(input: {
  table: PgTable
  idColumn: PgColumn
  condition: SQL | undefined
  orderBy: SQL[]
  chunkSize: number
  measuredValue?: SQL
  read(tx: SourceTransaction, ids: string[]): Promise<TRow[]>
}): Promise<TRow[]> {
  return db.transaction(
    async (tx) => {
      const candidates = await tx
        .select({
          id: sql<string>`${input.idColumn}`,
          bytes:
            sql<number>`octet_length((${input.measuredValue ?? sql`row_to_json(${input.table})`})::text)`.mapWith(
              Number
            ),
        })
        .from(input.table)
        .where(input.condition)
        .orderBy(...input.orderBy)
        .limit(Math.min(input.chunkSize, DATA_DRAIN_LIMITS.pageRows))
      for (const candidate of candidates) {
        assertKnownSizeWithinLimit(candidate.bytes, DATA_DRAIN_LIMITS.maxRowBytes, 'Drain record')
      }
      if (candidates.length === 0) return []
      return input.read(
        tx,
        candidates.map((row) => row.id)
      )
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )
}
