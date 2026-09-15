import { dbFor } from '@sim/db'
import { getErrorMessage } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import type {
  BoundedCleanupOptions,
  CleanupProgress,
  CleanupType,
} from '@/lib/cleanup/bounded-types'

export type CleanupTransaction = Parameters<
  Parameters<ReturnType<typeof dbFor>['transaction']>[0]
>[0]
export type CleanupQuery = <T>(query: (tx: CleanupTransaction) => Promise<T>) => Promise<T>

/** Local settings survive transaction pooling and never change another workload's defaults. */
export async function setCleanupTimeouts(tx: Pick<CleanupTransaction, 'execute'>): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '500ms'`)
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`)
}

/** One bounded DB transaction; storage under a binding lock must use a cancellable deadline. */
export const cleanupQuery: CleanupQuery = (query) =>
  dbFor('cleanup').transaction(async (tx) => {
    await setCleanupTimeouts(tx)
    return query(tx)
  })

export class CleanupTimeBudgetReached extends Error {}

export class BoundedCleanup {
  readonly progress: CleanupProgress
  private readonly startedAt: number
  constructor(
    readonly options: BoundedCleanupOptions,
    private readonly publish: (progress: CleanupProgress) => Promise<void>,
    private readonly now: () => number = Date.now,
    readonly query: CleanupQuery = cleanupQuery
  ) {
    this.startedAt = now()
    this.progress = {
      ...options,
      stages: Object.fromEntries(
        Object.entries(options.limits)
          .filter(([, limit]) => limit > 0)
          .map(([type]) => [
            type,
            { selected: 0, deleted: 0, skipped: 0, filesDeleted: 0, filesFailed: 0 },
          ])
      ),
      stage: 'scopes',
      durationMs: 0,
    }
  }

  expired(): boolean {
    return this.now() - this.startedAt >= 120_000
  }
  assertTimeRemaining(): void {
    if (this.expired()) throw new CleanupTimeBudgetReached('Cleanup work deadline reached')
  }
  remaining(type: CleanupType): number {
    return (this.options.limits[type] ?? 0) - (this.progress.stages[type]?.selected ?? 0)
  }
  stopped(): boolean {
    return (
      this.expired() ||
      Object.keys(this.options.limits).every((type) => this.remaining(type as CleanupType) === 0)
    )
  }
  async checkpoint(): Promise<void> {
    this.progress.durationMs = this.now() - this.startedAt
    await this.publish(structuredClone(this.progress))
  }
  /** Persist actual effects immediately, even if a later side effect in this batch fails. */
  async deleted(type: CleanupType, count: number): Promise<void> {
    const stage = this.progress.stages[type]
    if (!stage) throw new Error(`Unselected cleanup stage: ${type}`)
    stage.deleted += count
    await this.checkpoint()
  }
  async files(type: CleanupType, deleted: number, failed: number): Promise<void> {
    const stage = this.progress.stages[type]
    if (!stage) throw new Error(`Unselected cleanup stage: ${type}`)
    stage.filesDeleted += deleted
    stage.filesFailed += failed
    await this.checkpoint()
  }

  /**
   * Exclude previously selected roots so dry runs and concurrent restores cannot
   * repeatedly charge the same row. Mutation batches never exceed batchSize.
   */
  async batches<T>(
    type: CleanupType,
    select: (limit: number, seen: string[]) => Promise<T[]>,
    key: (row: T) => string,
    remove: (rows: T[]) => Promise<void>
  ): Promise<void> {
    const seen = new Set<string>()
    while (this.remaining(type) > 0 && !this.expired()) {
      this.progress.stage = type
      await this.checkpoint()
      const limit = Math.min(this.options.batchSize, this.remaining(type))
      const rows = await select(limit, [...seen])
      if (rows.length > limit) throw new Error(`${type} selection exceeded its batch limit`)
      if (rows.length === 0) break
      const stage = (this.progress.stages[type] ??= {
        selected: 0,
        deleted: 0,
        skipped: 0,
        filesDeleted: 0,
        filesFailed: 0,
      })
      for (const row of rows) {
        const id = key(row)
        if (seen.has(id)) throw new Error(`${type} selected a root twice`)
        seen.add(id)
      }
      stage.selected += rows.length
      await this.checkpoint()
      if (!this.options.dryRun) {
        const before = stage.deleted
        await remove(rows)
        stage.skipped += rows.length - (stage.deleted - before)
      }
      await this.checkpoint()
      if (rows.length < limit) break
    }
  }

  async finish(): Promise<CleanupProgress> {
    this.progress.stopReason = this.expired()
      ? 'time_budget'
      : this.stopped()
        ? 'budgets_exhausted'
        : 'scopes_exhausted'
    await this.checkpoint()
    return this.progress
  }
  async fail(error: unknown): Promise<void> {
    this.progress.stopReason = 'failed'
    this.progress.error = getErrorMessage(error)
    await this.checkpoint()
  }
}
