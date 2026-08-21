import { taskContext } from '@trigger.dev/core/v3'

/**
 * Carrier key for the marker written by the global `init` lifecycle hook.
 *
 * Parked on `globalThis` under a registered symbol rather than held in module
 * scope: the Trigger.dev build bundles the config entrypoint alongside the task
 * graph, and a module-level binding duplicated across bundles would let the
 * hook write one copy while dispatch code reads another.
 */
const INSIDE_TRIGGER_RUN = Symbol.for('sim.trigger-dev.inside-run')

interface TriggerRunCarrier {
  [INSIDE_TRIGGER_RUN]?: true
}

/**
 * Records that this process is executing a Trigger.dev run. Idempotent; called
 * from the global `init` lifecycle hook in `trigger.config.ts`, which
 * Trigger.dev documents as running before any task run.
 *
 * @see https://trigger.dev/docs/config/config-file#lifecycle-functions
 */
export function markInsideTriggerRun(): void {
  ;(globalThis as TriggerRunCarrier)[INSIDE_TRIGGER_RUN] = true
}

/**
 * Whether this process is executing a Trigger.dev run — the question that makes
 * dispatch decisions independent of which environment variables a given
 * container happens to have.
 *
 * Two independent signals, because this has been got wrong twice and either one
 * alone is a single point of failure:
 *
 * 1. `taskContext.isInsideTask`, the SDK runtime's own ambient flag. Already
 *    load-bearing in `getAsyncBackendType` for the same carve-out, so it is
 *    proven in this codebase rather than assumed.
 * 2. The `init`-hook marker, which uses only the public, documented lifecycle
 *    surface and so holds even if the internal `taskContext` shape moves.
 *
 * Neither signal is derived from `TRIGGER_SECRET_KEY` or `TRIGGER_DEV_ENABLED`.
 * Both are guesses about a process that Trigger.dev has already proven it owns
 * by being the thing running it.
 */
export function isInsideTriggerRun(): boolean {
  return taskContext.isInsideTask || (globalThis as TriggerRunCarrier)[INSIDE_TRIGGER_RUN] === true
}

/**
 * Clears the `init`-hook marker. Test-only: production processes are either a
 * Trigger.dev worker for their whole lifetime or never one.
 */
export function resetInsideTriggerRunForTests(): void {
  delete (globalThis as TriggerRunCarrier)[INSIDE_TRIGGER_RUN]
}
