import { and, inArray, notInArray, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { BoundedCleanup, CleanupTransaction } from '@/lib/cleanup/bounded'
import type { CleanupType } from '@/lib/cleanup/bounded-types'

/** Select and delete the same roots, reasserting eligibility after side effects. */
export async function boundedDelete(
  control: BoundedCleanup,
  type: CleanupType,
  table: PgTable,
  id: AnyPgColumn<{ data: string; notNull: true }>,
  eligibility: SQL | undefined,
  hooks: {
    before?: (ids: string[]) => Promise<void>
    beforeDelete?: (ids: string[], tx: CleanupTransaction) => Promise<void>
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
      const deleted = await control.query(async (tx) => {
        const targeted = hooks.beforeDelete
          ? await tx
              .select({ id })
              .from(table)
              .where(and(inArray(id, ids), eligibility))
              .for('update')
          : rows
        const targetedIds = targeted.map((row) => row.id)
        if (targetedIds.length === 0) return []
        control.assertTimeRemaining()
        await hooks.beforeDelete?.(targetedIds, tx)
        control.assertTimeRemaining()
        const deleted = await tx
          .delete(table)
          .where(and(inArray(id, targetedIds), eligibility))
          .returning({ id })
        if (hooks.beforeDelete && deleted.length !== targetedIds.length)
          throw new Error(`${type} eligibility changed during child cleanup`)
        return deleted
      })
      await control.deleted(type, deleted.length)
      await hooks.after?.(deleted.map((row) => row.id))
    }
  )
}
