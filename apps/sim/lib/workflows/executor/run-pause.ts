import type { ExecutionResult, PausePoint } from '@/executor/types'

/** Where a paused run waits: the run its pause is recorded under, and each pause point. */
export interface RunPause {
  runId: string
  points: PausePoint[]
}

/**
 * The run a pause is recorded under, which Resume workflow run names: the execution the engine ran
 * as, else `runId`, the id the run was started or resumed with. A resumed run that pauses again
 * records the pause under the run it resumed, not the resume attempt's own id.
 */
export function pausedRunIdOf(result: ExecutionResult, runId: string): string {
  return result.metadata?.executionId ?? runId
}

/** Where `result` waits when it paused, else null. */
export function runPauseOf(result: ExecutionResult, runId: string): RunPause | null {
  if (result.status !== 'paused') return null
  return { runId: pausedRunIdOf(result, runId), points: result.pausePoints ?? [] }
}
