import { env } from '@/lib/core/config/env'

export const SIM_AGENT_API_URL_DEFAULT = 'https://www.copilot.sim.ai'
export const SIM_AGENT_VERSION = '3.0.0'

/** Resolved copilot backend URL — reads from env with fallback to default. */
const rawAgentUrl = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT
export const SIM_AGENT_API_URL =
  rawAgentUrl.startsWith('http://') || rawAgentUrl.startsWith('https://')
    ? rawAgentUrl
    : SIM_AGENT_API_URL_DEFAULT

/** Default timeout for the copilot orchestration stream loop (60 min). */
export const ORCHESTRATION_TIMEOUT_MS = 3_600_000

/**
 * Watchdog cap for a single sim-executed copilot tool. A tool that neither
 * resolves nor rejects within its cap is failed with a timeout error so the
 * checkpoint loop can resume Go with an error result instead of wedging the
 * chat (and its pending-stream lock) behind a hung await forever.
 */
export const TOOL_WATCHDOG_DEFAULT_MS = 60_000

/**
 * Watchdog cap for tool classes with legitimately long runtimes (workflow
 * executions, media/image generation, sandboxed code, deep research). Those
 * tools carry their own inner budgets (plan execution timeouts, sandbox
 * timeouts), so this cap only backstops a true hang and sits above all of
 * them — matching ORCHESTRATION_TIMEOUT_MS so it never undercuts a legal run.
 */
export const TOOL_WATCHDOG_LONG_RUNNING_MS = ORCHESTRATION_TIMEOUT_MS

/** Extra slack the resume gate allows past the slowest pending tool's watchdog. */
export const TOOL_WATCHDOG_RESUME_GRACE_MS = 30_000

/** Timeout for the client-side streaming response handler (60 min). */
export const STREAM_TIMEOUT_MS = 3_600_000

/**
 * How long a workflow tool call waits for a browser to pick it up before the
 * server runs it itself.
 *
 * Workflow tools are client-routed, but the only thing that starts one is the
 * mounted chat view — a call frame that arrives while the user is on a
 * different chat is never dispatched by anyone, and the turn used to park for
 * the full STREAM_TIMEOUT_MS. The real pickup path (stream frame -> execute
 * POST -> claim) lands in ~1-3s, so 30s is an order of magnitude of headroom
 * and cannot steal work from a live tab.
 */
export const COPILOT_WORKFLOW_TOOL_CLIENT_GRACE_MS = 30_000

/** SessionStorage key for persisting active stream metadata across page reloads. */
export const STREAM_STORAGE_KEY = 'copilot_active_stream'

/** POST — send a chat message through the unified mothership chat surface. */
export const MOTHERSHIP_CHAT_API_PATH = '/api/mothership/chat'

/** POST — confirm or reject a tool call. */
export const COPILOT_CONFIRM_API_PATH = '/api/copilot/confirm'

export const COPILOT_WORKFLOW_EXECUTION_CONFLICT_CODE =
  'COPILOT_WORKFLOW_EXECUTION_CONFLICT' as const

/** Maximum entries in the in-memory SSE tool-event dedup cache. */
export const STREAM_BUFFER_MAX_DEDUP_ENTRIES = 1_000

/** Approximate max inline tool-result budget before artifact/error handling takes over. */
export const TOOL_RESULT_MAX_INLINE_TOKENS = 50_000

/** Rough chars-per-token estimate used when only serialized text length is available. */
export const TOOL_RESULT_ESTIMATED_CHARS_PER_TOKEN = 4

/** Approximate max inline tool-result size in characters. */
export const TOOL_RESULT_MAX_INLINE_CHARS =
  TOOL_RESULT_MAX_INLINE_TOKENS * TOOL_RESULT_ESTIMATED_CHARS_PER_TOKEN

export const COPILOT_MODES = ['assistant', 'build', 'plan'] as const

export const COPILOT_REQUEST_MODES = ['assistant', 'build', 'plan', 'agent'] as const

/**
 * Model stamped on a mothership conversation row created outside the
 * interactive send path: `POST /api/mothership/chats` (an empty chat), the
 * `sim chat` API turn, and the inbox executor's chat for an email task.
 * Shared so those three cannot drift onto different models for the same
 * conversation type.
 *
 * The interactive send path (`lib/copilot/chat/post.ts`) does not read this:
 * the chat it creates is stamped with the model it also runs the turn and
 * generates the title with, which that module owns separately.
 */
export const MOTHERSHIP_CHAT_DEFAULT_MODEL = 'claude-opus-4-8'
