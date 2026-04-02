/**
 * Sanitization for JSON data round-tripped through Redis Lua cjson.
 *
 * Lua's cjson library cannot distinguish between empty arrays `[]` and empty objects `{}`.
 * Both serialize to `{}` in Lua tables. When BullMQ's internal Lua scripts touch job data,
 * any empty array in the payload silently becomes `{}`.
 *
 * Applied once at the worker boundary before data enters the execution engine.
 */

/**
 * Returns `value` if it's an array, otherwise `[]`.
 */
export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : []
}

const EXECUTION_STATE_ARRAY_FIELDS = [
  'executedBlocks',
  'blockLogs',
  'completedLoops',
  'activeExecutionPath',
  'pendingQueue',
  'remainingEdges',
  'completedPauseContexts',
]

/**
 * Normalizes all known array fields on a BullMQ-deserialized workflow execution payload.
 * Mutates in place — call once before passing into the execution engine.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeBullMQPayload(payload: any): void {
  if (!payload) return

  payload.selectedOutputs = ensureArray(payload.selectedOutputs)

  if (payload.metadata) {
    payload.metadata.callChain = ensureArray(payload.metadata.callChain)

    if (payload.metadata.pendingBlocks !== undefined) {
      payload.metadata.pendingBlocks = ensureArray(payload.metadata.pendingBlocks)
    }

    if (payload.metadata.workflowStateOverride?.edges !== undefined) {
      payload.metadata.workflowStateOverride.edges = ensureArray(
        payload.metadata.workflowStateOverride.edges
      )
    }
  }

  if (payload.runFromBlock?.sourceSnapshot) {
    const state = payload.runFromBlock.sourceSnapshot
    for (const field of EXECUTION_STATE_ARRAY_FIELDS) {
      if (field in state && !Array.isArray(state[field])) {
        state[field] = []
      }
    }

    if (state.dagIncomingEdges && typeof state.dagIncomingEdges === 'object') {
      for (const key of Object.keys(state.dagIncomingEdges)) {
        if (!Array.isArray(state.dagIncomingEdges[key])) {
          state.dagIncomingEdges[key] = []
        }
      }
    }
  }
}
