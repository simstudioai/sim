import { db } from '@sim/db'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import {
  measureSearchStage,
  recordSearchStageDuration,
  type SearchStage,
} from '@/lib/knowledge/search/diagnostics'

export const SEARCH_RETRIEVAL_BUDGET_MS = 8000
export type RetrievalLeg = 'vector' | 'keyword' | 'tags'
export type SearchExecutor = Pick<DbTransaction, 'select' | 'execute'>

export class SearchDeadlineError extends Error {
  constructor() {
    super('Search reached its retrieval deadline. Retry with a narrower query or source filter.')
    this.name = 'SearchDeadlineError'
  }
}

/** One leg's state, using the hybrid request's shared deadline across every refill and fallback. */
export class SearchBudget {
  timedOut = false

  constructor(
    readonly leg: RetrievalLeg,
    readonly deadline: number,
    readonly signal?: AbortSignal
  ) {}

  remaining(): number {
    this.signal?.throwIfAborted()
    const remaining = Math.ceil(this.deadline - performance.now())
    if (remaining <= 0) {
      this.timedOut = true
      throw new SearchDeadlineError()
    }
    return remaining
  }

  isTimeout(error: unknown): boolean {
    this.signal?.throwIfAborted()
    if (error instanceof SearchDeadlineError || getPostgresErrorCode(error) === '57014') {
      this.timedOut = true
      return true
    }
    return false
  }

  /**
   * Only acquisition is raced. An expired queued transaction rolls back before executing work.
   * Once acquired, PostgreSQL cancels the statement and we await rollback/release before returning.
   * This avoids postgres.js cancellation packets racing a subsequent query on a pooled connection.
   */
  async query<T>(
    stage: SearchStage,
    run: (executor: SearchExecutor) => PromiseLike<T>
  ): Promise<T> {
    const started = performance.now()
    const remaining = this.remaining()
    let acquired = false
    let expired = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectAcquisition: (error: unknown) => void = () => {}
    const onAbort = () => {
      if (!acquired) {
        expired = true
        rejectAcquisition(this.signal?.reason)
      }
    }
    const acquisition = new Promise<never>((_, reject) => {
      rejectAcquisition = reject
      timer = setTimeout(() => {
        expired = true
        this.timedOut = true
        reject(new SearchDeadlineError())
      }, remaining)
      this.signal?.addEventListener('abort', onAbort, { once: true })
    })
    const work = db.transaction(async (tx) => {
      acquired = true
      clearTimeout(timer)
      this.signal?.removeEventListener('abort', onAbort)
      if (expired) throw new SearchDeadlineError()
      recordSearchStageDuration(`${this.leg}.connection_acquire`, performance.now() - started)
      const timeout = String(this.remaining())
      await tx.execute(sql`SELECT set_config('statement_timeout', ${timeout}, true)`)
      this.remaining()
      return measureSearchStage(stage, () => run(tx))
    })
    try {
      const result = await Promise.race([work, acquisition])
      this.signal?.throwIfAborted()
      return result
    } catch (error) {
      if (this.isTimeout(error)) throw new SearchDeadlineError()
      throw error
    } finally {
      clearTimeout(timer)
      this.signal?.removeEventListener('abort', onAbort)
      if (!acquired)
        recordSearchStageDuration(`${this.leg}.connection_acquire`, performance.now() - started)
    }
  }
}

/** Execute SQL with stage diagnostics and, for live search, the shared retrieval deadline. */
export function runSearchQuery<T>(
  budget: SearchBudget | undefined,
  stage: SearchStage,
  run: (executor: SearchExecutor) => PromiseLike<T>
): Promise<T> {
  return budget ? budget.query(stage, run) : measureSearchStage(stage, () => run(db))
}
