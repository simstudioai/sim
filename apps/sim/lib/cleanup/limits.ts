import type { RowBudget } from '@/lib/cleanup/batch-delete'

export const LOG_CLEANUP_TYPES = [
  'workflowLogs',
  'jobLogs',
  'largeValues',
  'legacyLargeValues',
  'orphanSnapshots',
  'staleReferences',
  'staleDependencies',
  'largeValueTombstones',
] as const
export const SOFT_DELETE_CLEANUP_TYPES = [
  'workflows',
  'chats',
  'legacyFiles',
  'files',
  'knowledgeBases',
  'folders',
  'userTables',
  'memories',
  'mcpServers',
  'workflowMcpServers',
  'orphanKnowledgeBaseBindings',
] as const
export type CleanupType =
  | (typeof LOG_CLEANUP_TYPES)[number]
  | (typeof SOFT_DELETE_CLEANUP_TYPES)[number]
export type CleanupLimits = Partial<Record<CleanupType, number>>
export type CleanupBudgets = Record<CleanupType, RowBudget>
export type LimitedCleanupPayload = { limits: CleanupLimits }

/** One mutable budget per type, shared across every owner scope in the queued job. */
export function createCleanupBudgets(limits: CleanupLimits): CleanupBudgets {
  return Object.fromEntries(
    [...LOG_CLEANUP_TYPES, ...SOFT_DELETE_CLEANUP_TYPES].map((type) => [
      type,
      { remaining: limits[type] ?? 0 },
    ])
  ) as CleanupBudgets
}
