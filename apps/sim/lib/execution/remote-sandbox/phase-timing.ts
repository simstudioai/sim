/**
 * Phases of one sandbox execution, in the order they run. `lease` spans the whole acquisition
 * (session lock included); for a session, `lookup` is the part of it spent finding or creating the
 * machine. `cli` is time spent installing or repairing deployment tooling: on a new machine, or
 * after a launch refused a changed CLI. A reused machine verifies it inside `run`.
 */
type SandboxPhase =
  | 'resolve'
  | 'access'
  | 'lease'
  | 'lookup'
  | 'cli'
  | 'prepare'
  | 'run'
  | 'collect'
  | 'release'

/** Wall-clock milliseconds per phase; a phase that did not finish is absent. */
export type SandboxPhaseTimings = Partial<Record<SandboxPhase, number>>

/** Accumulates per-phase wall time for one execution's log line. */
export interface SandboxPhaseTimer {
  readonly timings: SandboxPhaseTimings
  /** Starts timing a phase; the returned function records its duration. */
  start(phase: SandboxPhase): () => void
}

/** Creates a timer whose callbacks record rounded milliseconds; unfinished phases stay absent. */
export function createSandboxPhaseTimer(): SandboxPhaseTimer {
  const timings: SandboxPhaseTimings = {}
  return {
    timings,
    start(phase) {
      const startedAt = performance.now()
      return () => {
        timings[phase] = Math.round(performance.now() - startedAt)
      }
    },
  }
}
