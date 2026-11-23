import type { V2ExecuteWorkflowData } from '@/lib/api/contracts/v2/workflows'
import type { RunPause } from '@/lib/workflows/executor/run-pause'

/**
 * The v2 wire shape of where a run waits, shared by the execute and resume results; null when it
 * is not paused.
 */
export function presentV2RunPause(
  pause: RunPause | null | undefined
): V2ExecuteWorkflowData['paused'] {
  if (!pause) return null
  return {
    runId: pause.runId,
    points: pause.points.map((point) => ({
      contextId: point.contextId,
      kind: point.pauseKind,
      status: point.resumeStatus,
    })),
  }
}
