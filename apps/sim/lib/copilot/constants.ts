import { env } from '@/lib/core/config/env'

export const SIM_AGENT_API_URL_DEFAULT = 'https://copilot.sim.ai'
export const SIM_AGENT_VERSION = '1.0.3'

/** Resolved copilot backend URL — reads from env with fallback to default. */
const rawAgentUrl = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT
export const SIM_AGENT_API_URL =
  rawAgentUrl.startsWith('http://') || rawAgentUrl.startsWith('https://')
    ? rawAgentUrl
    : SIM_AGENT_API_URL_DEFAULT

// ---------------------------------------------------------------------------
// Redis key prefixes
// ---------------------------------------------------------------------------

/** Redis key prefix for tool call confirmation payloads (polled by waitForToolDecision). */
export const REDIS_TOOL_CALL_PREFIX = 'tool_call:'

/** Redis key prefix for copilot SSE stream buffers. */
export const REDIS_COPILOT_STREAM_PREFIX = 'copilot_stream:'

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/** Default timeout for the copilot orchestration stream loop (5 min). */
export const ORCHESTRATION_TIMEOUT_MS = 300_000

/** Timeout for the client-side streaming response handler (10 min). */
export const STREAM_TIMEOUT_MS = 600_000

/** TTL for Redis tool call confirmation entries (24 h). */
export const REDIS_TOOL_CALL_TTL_SECONDS = 86_400

// ---------------------------------------------------------------------------
// Tool decision polling
// ---------------------------------------------------------------------------

/** Initial poll interval when waiting for a user tool decision. */
export const TOOL_DECISION_INITIAL_POLL_MS = 100

/** Maximum poll interval when waiting for a user tool decision. */
export const TOOL_DECISION_MAX_POLL_MS = 3_000

/** Backoff multiplier for the tool decision poll interval. */
export const TOOL_DECISION_POLL_BACKOFF = 1.5

// ---------------------------------------------------------------------------
// Stream resume
// ---------------------------------------------------------------------------

/** Maximum number of resume attempts before giving up. */
export const MAX_RESUME_ATTEMPTS = 3

/** SessionStorage key for persisting active stream metadata across page reloads. */
export const STREAM_STORAGE_KEY = 'copilot_active_stream'

// ---------------------------------------------------------------------------
// Client-side streaming batching
// ---------------------------------------------------------------------------

/** Delay (ms) before processing the next queued message after stream completion. */
export const QUEUE_PROCESS_DELAY_MS = 100

/** Delay (ms) before invalidating subscription queries after stream completion. */
export const SUBSCRIPTION_INVALIDATE_DELAY_MS = 1_000

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Maximum character length for an optimistic chat title derived from a user message. */
export const OPTIMISTIC_TITLE_MAX_LENGTH = 50

// ---------------------------------------------------------------------------
// Copilot API paths (client-side fetch targets)
// ---------------------------------------------------------------------------

/** POST — send a chat message to the copilot. */
export const COPILOT_CHAT_API_PATH = '/api/copilot/chat'

/** GET — resume/replay a copilot SSE stream. */
export const COPILOT_CHAT_STREAM_API_PATH = '/api/copilot/chat/stream'

/** POST — persist chat messages / plan artifact / config. */
export const COPILOT_UPDATE_MESSAGES_API_PATH = '/api/copilot/chat/update-messages'

/** DELETE — delete a copilot chat. */
export const COPILOT_DELETE_CHAT_API_PATH = '/api/copilot/chat/delete'

/** POST — confirm or reject a tool call. */
export const COPILOT_CONFIRM_API_PATH = '/api/copilot/confirm'

/** POST — forward diff-accepted/rejected stats to the copilot backend. */
export const COPILOT_STATS_API_PATH = '/api/copilot/stats'

/** GET — load checkpoints for a chat. */
export const COPILOT_CHECKPOINTS_API_PATH = '/api/copilot/checkpoints'

/** POST — revert to a checkpoint. */
export const COPILOT_CHECKPOINTS_REVERT_API_PATH = '/api/copilot/checkpoints/revert'

/** GET/POST/DELETE — manage auto-allowed tools. */
export const COPILOT_AUTO_ALLOWED_TOOLS_API_PATH = '/api/copilot/auto-allowed-tools'

/** GET — fetch user credentials for masking. */
export const COPILOT_CREDENTIALS_API_PATH = '/api/copilot/credentials'

// ---------------------------------------------------------------------------
// Dedup limits
// ---------------------------------------------------------------------------

/** Maximum entries in the in-memory SSE tool-event dedup cache. */
export const STREAM_BUFFER_MAX_DEDUP_ENTRIES = 1_000
