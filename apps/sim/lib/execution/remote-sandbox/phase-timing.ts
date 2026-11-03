/**
 * Phases of one sandbox execution, in the order they run. `lease` spans the whole acquisition
 * (session lock included); for a session, `lookup` and `cli` are the parts of it spent finding or
 * creating the machine and verifying its deployment tooling.
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
