import type { V2WorkflowTrigger } from '@/lib/api/contracts/v2/workflows'
import type { WorkflowTriggerHealth } from '@/lib/workflows/triggers/health'

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
