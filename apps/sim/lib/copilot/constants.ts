import { env } from '@/lib/core/config/env'

export const SIM_AGENT_API_URL_DEFAULT = 'https://copilot.sim.ai'
export const SIM_AGENT_VERSION = '3.0.0'

/** Resolved copilot backend URL — reads from env with fallback to default. */
const rawAgentUrl = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT
export const SIM_AGENT_API_URL =
  rawAgentUrl.startsWith('http://') || rawAgentUrl.startsWith('https://')
    ? rawAgentUrl
    : SIM_AGENT_API_URL_DEFAULT

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/** Default timeout for the copilot orchestration stream loop (60 min). */
export const ORCHESTRATION_TIMEOUT_MS = 3_600_000

/** Timeout for the client-side streaming response handler (60 min). */
export const STREAM_TIMEOUT_MS = 3_600_000

// ---------------------------------------------------------------------------
// Stream resume
// ---------------------------------------------------------------------------

/** SessionStorage key for persisting active stream metadata across page reloads. */
export const STREAM_STORAGE_KEY = 'copilot_active_stream'

// ---------------------------------------------------------------------------
// Copilot API paths (client-side fetch targets)
// ---------------------------------------------------------------------------

/** POST — send a chat message through the unified mothership chat surface. */
export const MOTHERSHIP_CHAT_API_PATH = '/api/mothership/chat'

/** Backwards-compatible alias while remaining callers migrate. */
export const COPILOT_CHAT_API_PATH = MOTHERSHIP_CHAT_API_PATH

/** POST — confirm or reject a tool call. */
export const COPILOT_CONFIRM_API_PATH = '/api/copilot/confirm'

/** POST — forward diff-accepted/rejected stats to the copilot backend. */
export const COPILOT_STATS_API_PATH = '/api/copilot/stats'

// ---------------------------------------------------------------------------
// Dedup limits
// ---------------------------------------------------------------------------

/** Maximum entries in the in-memory SSE tool-event dedup cache. */
export const STREAM_BUFFER_MAX_DEDUP_ENTRIES = 1_000

// ---------------------------------------------------------------------------
// Tool result size limits
// ---------------------------------------------------------------------------

/** Approximate max inline tool-result budget before artifact/error handling takes over. */
export const TOOL_RESULT_MAX_INLINE_TOKENS = 50_000

/** Rough chars-per-token estimate used when only serialized text length is available. */
export const TOOL_RESULT_ESTIMATED_CHARS_PER_TOKEN = 4

/** Approximate max inline tool-result size in characters. */
export const TOOL_RESULT_MAX_INLINE_CHARS =
  TOOL_RESULT_MAX_INLINE_TOKENS * TOOL_RESULT_ESTIMATED_CHARS_PER_TOKEN

// ---------------------------------------------------------------------------
// Copilot modes
// ---------------------------------------------------------------------------

export const COPILOT_MODES = ['ask', 'build', 'plan'] as const

export const COPILOT_REQUEST_MODES = ['ask', 'build', 'plan', 'agent'] as const
