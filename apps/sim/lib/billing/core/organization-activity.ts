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

export interface ActivityStretch {
  workflowRuns: number
  completed: number
  failed: number
  /** Duration is summed, not averaged, so days combine into an exact mean. */
  durationSum: number
  durationCount: number
  chatRuns: number
  /** Ids rather than a count: a member active on two days is still one member. */
  chatMembers: string[]
  /** Runs not yet finished. A stretch holding any can still change, so it is never cached. */
  inFlight: number
}

export const EMPTY_ACTIVITY_STRETCH: ActivityStretch = {
  workflowRuns: 0,
  completed: 0,
  failed: 0,
  durationSum: 0,
  durationCount: 0,
  chatRuns: 0,
  chatMembers: [],
  inFlight: 0,
}

/** Several stretches of activity as one; members are unioned, never double-counted. */
export function combineActivity(stretches: Iterable<ActivityStretch>): ActivityStretch {
  const total = { ...EMPTY_ACTIVITY_STRETCH }
  const members = new Set<string>()
  for (const stretch of stretches) {
    total.workflowRuns += stretch.workflowRuns
    total.completed += stretch.completed
    total.failed += stretch.failed
    total.durationSum += stretch.durationSum
    total.durationCount += stretch.durationCount
    total.chatRuns += stretch.chatRuns
    total.inFlight += stretch.inFlight
    for (const member of stretch.chatMembers) members.add(member)
  }
  return { ...total, chatMembers: [...members] }
}
