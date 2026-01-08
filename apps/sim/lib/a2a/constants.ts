/**
 * A2A Protocol Constants (v0.2.6)
 */

/** A2A Protocol version */
export const A2A_PROTOCOL_VERSION = '0.2.6'

/** Default timeout for A2A requests (5 minutes) */
export const A2A_DEFAULT_TIMEOUT = 300000

/** Maximum message history length */
export const A2A_MAX_HISTORY_LENGTH = 100

/** Supported authentication schemes */
export const A2A_AUTH_SCHEMES = ['bearer', 'apiKey', 'oauth2', 'none'] as const

/** Task state values (v0.2.6) */
export const A2A_TASK_STATE = {
  SUBMITTED: 'submitted',
  WORKING: 'working',
  INPUT_REQUIRED: 'input-required',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
  REJECTED: 'rejected',
  AUTH_REQUIRED: 'auth-required',
  UNKNOWN: 'unknown',
} as const

/** Valid task state transitions */
export const A2A_VALID_TRANSITIONS: Record<string, string[]> = {
  submitted: ['working', 'failed', 'canceled', 'rejected'],
  working: ['completed', 'failed', 'canceled', 'input-required'],
  'input-required': ['working', 'failed', 'canceled'],
  'auth-required': ['working', 'failed', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
  rejected: [],
  unknown: [],
}

/** JSON-RPC methods supported by A2A */
export const A2A_METHODS = {
  TASKS_SEND: 'tasks/send',
  TASKS_GET: 'tasks/get',
  TASKS_CANCEL: 'tasks/cancel',
  TASKS_SEND_SUBSCRIBE: 'tasks/sendSubscribe',
} as const

/** Well-known path for agent card discovery */
export const A2A_WELL_KNOWN_PATH = '/.well-known/agent.json'

/** Default capabilities for new agents */
export const A2A_DEFAULT_CAPABILITIES = {
  streaming: true,
  pushNotifications: false,
  stateTransitionHistory: true,
} as const

/** Default input/output modes */
export const A2A_DEFAULT_INPUT_MODES = ['text', 'data'] as const
export const A2A_DEFAULT_OUTPUT_MODES = ['text', 'data'] as const

/** Cache settings */
export const A2A_CACHE = {
  AGENT_CARD_TTL: 3600, // 1 hour
  TASK_TTL: 86400, // 24 hours
} as const
