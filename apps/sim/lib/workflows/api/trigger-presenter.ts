import type { V2WorkflowTrigger, V2WorkspaceSchedule } from '@/lib/api/contracts/v2/workflows'
import type {
  WorkflowTriggerHealth,
  WorkspaceScheduleRecord,
} from '@/lib/workflows/triggers/health'

/** The v2 wire shape of one live trigger, shared by the list and the update. */
export function presentV2WorkflowTrigger(trigger: WorkflowTriggerHealth): V2WorkflowTrigger {
  return {
    blockId: trigger.blockId,
    kind: trigger.kind,
    provider: trigger.provider,
    enabled: trigger.enabled,
    status: trigger.status,
    failedCount: trigger.failedCount,
    lastFailedAt: trigger.lastFailedAt?.toISOString() ?? null,
    nextRunAt: trigger.nextRunAt?.toISOString() ?? null,
    lastRanAt: trigger.lastRanAt?.toISOString() ?? null,
    cronExpression: trigger.cronExpression,
    timezone: trigger.timezone,
    url: trigger.url,
  }
}

/** The v2 wire shape of one schedule in the workspace-wide list. */
export function presentV2WorkspaceSchedule({
  workflowId,
  workflowName,
  health,
}: WorkspaceScheduleRecord): V2WorkspaceSchedule {
  const { kind, provider, url, timezone, ...schedule } = presentV2WorkflowTrigger(health)
  return { workflowId, workflowName, ...schedule, timezone: timezone ?? 'UTC' }
}
