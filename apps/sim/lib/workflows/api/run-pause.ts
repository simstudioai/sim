import type { V2ExecuteWorkflowData } from '@/lib/api/contracts/v2/workflows'
import type { PausePoint } from '@/executor/types'

/**
 * The v2 wire shape of where a run waits, shared by the execute and resume results: the run the
 * pause is recorded under (which Resume workflow run names) and each of its points.
 */
export function presentV2RunPause(
  runId: string,
  points: readonly PausePoint[]
): NonNullable<V2ExecuteWorkflowData['paused']> {
  return {
    runId,
    points: points.map((point) => ({
      contextId: point.contextId,
      kind: point.pauseKind,
      status: point.resumeStatus,
    })),
  }
}
