export { AGENT_CARD_PATH } from '@a2a-js/sdk'

import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'

export const A2A_PROTOCOL_VERSION = '0.3.0'

export const A2A_DEFAULT_TIMEOUT = DEFAULT_EXECUTION_TIMEOUT_MS

/**
 * Maximum number of messages stored per task in the database.
 * Messages beyond this limit should be truncated to prevent unbounded array growth.
 * For capacity planning: ~100 messages * ~1KB avg = ~100KB per task max.
 */
export const A2A_MAX_HISTORY_LENGTH = 100

export const A2A_DEFAULT_CAPABILITIES = {
  streaming: true,
  pushNotifications: false,
  stateTransitionHistory: true,
} as const

export const A2A_DEFAULT_INPUT_MODES = ['text'] as const

export const A2A_DEFAULT_OUTPUT_MODES = ['text'] as const

export const A2A_CACHE = {
  AGENT_CARD_TTL: 3600, // 1 hour
  TASK_TTL: 86400, // 24 hours
} as const

export const A2A_TERMINAL_STATES = ['completed', 'failed', 'canceled', 'rejected'] as const
