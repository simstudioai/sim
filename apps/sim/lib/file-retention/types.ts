import type { PlanCategory } from '@/lib/billing/plan-helpers'
import type { CleanupBudgets } from '@/lib/cleanup/limits'

export interface FileRetentionOptions {
  plan: PlanCategory
  cutoff: Date
  label: string
  budgets?: CleanupBudgets
}

export interface FileVersionCleanupResult {
  deleted: number
  attempted: number
}

/** Exact selected rows survive the storage phase; failed objects never enter row deletion. */
export interface FileArchiveCleanup {
  cleanupStorage(): Promise<FileArchiveDeletion>
}

export interface FileArchiveDeletion {
  filesDeleted: number
  deleteRows(): Promise<number>
}
