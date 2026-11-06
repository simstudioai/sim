import type { PlanCategory } from '@/lib/billing/plan-helpers'
import type { CleanupBudgets } from '@/lib/cleanup/limits'

/** Queued workspace policy and shared budgets; Projects resolve their current payer policy in-transaction. */
export interface FileRetentionOptions {
  plan: PlanCategory
  cutoff: Date
  label: string
  budgets?: CleanupBudgets
}

/** Released versions and attempted selections, used to preserve the shared run limit. */
export interface FileVersionCleanupResult {
  deleted: number
  attempted: number
}

/** Exact selected rows survive the storage phase; failed objects never enter row deletion. */
export interface FileArchiveCleanup {
  cleanupStorage(): Promise<FileArchiveDeletion>
}

/** Completed storage-phase count and deferred row cleanup; outbox-backed deletions are not counted as physical deletes here. */
export interface FileArchiveDeletion {
  filesDeleted: number
  deleteRows(): Promise<number>
}
