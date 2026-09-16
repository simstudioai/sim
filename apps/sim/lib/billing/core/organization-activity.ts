export const ACTIVITY_DIMENSIONS = ['workspace', 'workflow', 'member', 'trigger'] as const
export type ActivityDimension = (typeof ACTIVITY_DIMENSIONS)[number]

export const ACTIVITY_SORTS = ['runs', 'failures', 'duration'] as const
export type ActivitySort = (typeof ACTIVITY_SORTS)[number]
export const ACTIVITY_PAGE_SIZE = 25
export const ACTIVITY_MAX_PAGE = 1000

export interface ActivityMetrics {
  workflowRuns: number
  completed: number
  failed: number
  chatRuns: number
  chatMembers: number
  failureRate: number | null
  averageDurationMs: number | null
}

export interface ActivityScope {
  organizationId: string
  workspaceId?: string
  start: Date
  end: Date
}

export type ActivityAggregate = {
  workflowRuns: string | number
  completed: string | number
  failed: string | number
  chatRuns: string | number
  chatMembers: string | number
  averageDurationMs: string | number | null
}

/** Terminal failures exclude cancelled, paused, and still-running executions. */
export function activityMetrics(row?: ActivityAggregate): ActivityMetrics {
  const completed = Number(row?.completed ?? 0)
  const failed = Number(row?.failed ?? 0)
  return {
    workflowRuns: Number(row?.workflowRuns ?? 0),
    completed,
    failed,
    chatRuns: Number(row?.chatRuns ?? 0),
    chatMembers: Number(row?.chatMembers ?? 0),
    failureRate: completed + failed > 0 ? failed / (completed + failed) : null,
    averageDurationMs: row?.averageDurationMs == null ? null : Number(row.averageDurationMs),
  }
}
