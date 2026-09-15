import { and, inArray, notInArray, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { BoundedCleanup } from '@/lib/cleanup/bounded'
import type { CleanupType } from '@/lib/cleanup/bounded-types'

/** Select and delete the same roots, reasserting eligibility after side effects. */
export async function boundedDelete(
  control: BoundedCleanup,
  type: CleanupType,
  table: PgTable,
  id: PgColumn,
  eligibility: SQL | undefined,
  hooks: {
    before?: (ids: string[]) => Promise<void>
    after?: (ids: string[]) => Promise<void>
  } = {}
) {
  if (!eligibility) throw new Error(`Missing ${type} cleanup eligibility`)
  await control.batches(
    type,
    (limit, seen) =>
      control.query(async (tx) =>
        tx
          .select({ id })
          .from(table)
          .where(and(eligibility, seen.length ? notInArray(id, seen) : undefined))
          .limit(limit)
      ) as Promise<{ id: string }[]>,
    (row) => row.id,
    async (rows) => {
      const ids = rows.map((row) => row.id)
      await hooks.before?.(ids)
      const deleted = await control.query(async (tx) =>
        tx
          .delete(table)
          .where(and(inArray(id, ids), eligibility))
          .returning({ id })
      )
      await control.deleted(type, deleted.length)
      await hooks.after?.(ids)
    }
  )
}
