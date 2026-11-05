import type { LogFilters, LogSnapshotPage } from '@/hooks/queries/logs'

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: LogFilters) =>
    [...logKeys.lists(), workspaceId ?? '', filters] as const,
  snapshot: (workspaceId: string | undefined, filters: LogFilters) =>
    [...logKeys.list(workspaceId, filters), 'snapshot'] as const,
  newCounts: () => [...logKeys.all, 'newCount'] as const,
  newCount: (workspaceId: string | undefined, filters: LogFilters, snapshotAt?: string) =>
    [...logKeys.newCounts(), workspaceId ?? '', filters, snapshotAt ?? ''] as const,
  updates: () => [...logKeys.all, 'updates'] as const,
  update: (workspaceId: string | undefined, snapshot?: LogSnapshotPage) =>
    [
      ...logKeys.updates(),
      workspaceId ?? '',
      snapshot?.query,
      snapshot?.snapshotAt,
      snapshot?.revision,
    ] as const,
  details: () => [...logKeys.all, 'detail'] as const,
  detail: (workspaceId: string | undefined, logId: string | undefined) =>
    [...logKeys.details(), workspaceId ?? '', logId ?? ''] as const,
  byExecutionAll: () => [...logKeys.all, 'byExecution'] as const,
  byExecution: (workspaceId: string | undefined, executionId: string | undefined) =>
    [...logKeys.byExecutionAll(), workspaceId ?? '', executionId ?? ''] as const,
  stats: () => [...logKeys.all, 'stats'] as const,
  stat: (workspaceId: string | undefined, filters: object) =>
    [...logKeys.stats(), workspaceId ?? '', filters] as const,
  executionSnapshots: () => [...logKeys.all, 'executionSnapshot'] as const,
  executionSnapshot: (executionId: string | undefined) =>
    [...logKeys.executionSnapshots(), executionId ?? ''] as const,
}
