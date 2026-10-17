/** Execution leases outlive the stream while a tool still owns handlers or cleanup. */
export const SIM_TOOL_EXECUTION_LEASE_SECONDS = 60
export const SIM_TOOL_EXECUTION_HEARTBEAT_MS = 20_000

export interface SimToolExecutionOwner {
  toolCallId: string
  runId: string
  userId: string
  ownerToken: string
}

/**
 * Sim executions one call may start: the first, and a re-run each time a takeover finds the
 * previous owner died before recording a result. A tool that kills its executor every time
 * ends with {@link EXHAUSTED_SIM_TOOL_MESSAGE} instead of re-running forever.
 */
export const SIM_TOOL_EXECUTION_MAX_ATTEMPTS = 3

export const INTERRUPTED_SIM_TOOL_MESSAGE =
  'Tool execution lost its owner before a result was recorded. Its outcome is unknown; inspect current state before retrying a mutation.'

/**
 * A call starts, the first time or again after a takeover, only with at least this much of its
 * deadline left; otherwise it fails as not run instead of starting work that would likely be cut
 * off with its outcome unknown. About 99% of non-workflow tool calls finish within a minute.
 */
export const SIM_TOOL_MIN_START_BUDGET_MS = 60_000

export const DEADLINE_SIM_TOOL_MESSAGE =
  'Tool execution was interrupted because the Sim server running it stopped, and too little of its time remained to run it again. Its outcome is unknown; inspect current state before retrying a mutation.'

export const EXHAUSTED_SIM_TOOL_MESSAGE = `Tool execution was interrupted ${SIM_TOOL_EXECUTION_MAX_ATTEMPTS} times because the Sim server running it stopped, so it was not run again. Its outcome is unknown; inspect current state before retrying a mutation.`

export class SimToolExecutionLeaseLostError extends Error {
  constructor() {
    super(INTERRUPTED_SIM_TOOL_MESSAGE)
    this.name = 'SimToolExecutionLeaseLostError'
  }
}
