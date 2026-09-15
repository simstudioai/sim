/** Root budgets are shared by all owner scopes in one invocation, including dry runs. */
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
export type BoundedCleanupJobType = 'cleanup-logs' | 'cleanup-soft-deletes'
export type BoundedCleanupOptions = {
  limits: Partial<Record<CleanupType, number>>
  batchSize: number
  dryRun: boolean
  requestId: string
}
export type BoundedCleanupPayload = { mode: 'bounded'; options: BoundedCleanupOptions }
export type CleanupStageProgress = {
  selected: number
  deleted: number
  skipped: number
  filesDeleted: number
  filesFailed: number
}
export type CleanupProgress = {
  requestId: string
  dryRun: boolean
  limits: BoundedCleanupOptions['limits']
  batchSize: number
  stages: Partial<Record<CleanupType, CleanupStageProgress>>
  stage: CleanupType | 'scopes'
  durationMs: number
  stopReason?: 'budgets_exhausted' | 'scopes_exhausted' | 'time_budget' | 'failed'
  error?: string
}
