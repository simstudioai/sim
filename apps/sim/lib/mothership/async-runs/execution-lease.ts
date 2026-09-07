/** Execution leases outlive the stream while a tool still owns handlers or cleanup. */
export const SIM_TOOL_EXECUTION_LEASE_SECONDS = 60
export const SIM_TOOL_EXECUTION_HEARTBEAT_MS = 20_000

export interface SimToolExecutionOwner {
  toolCallId: string
  runId: string
  userId: string
  ownerToken: string
}

export const INTERRUPTED_SIM_TOOL_MESSAGE =
  'Tool execution lost its owner before a result was recorded. Its outcome is unknown; inspect current state before retrying a mutation.'

export class SimToolExecutionLeaseLostError extends Error {
  constructor() {
    super(INTERRUPTED_SIM_TOOL_MESSAGE)
    this.name = 'SimToolExecutionLeaseLostError'
  }
}
