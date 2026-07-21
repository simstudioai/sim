/**
 * Provider-neutral HTTP client for the Claude Platform Managed Agents API.
 *
 * A thin wrapper around `fetch` that speaks the Managed Agents beta. It has
 * NO Sim-domain dependencies (no `@sim/db`, no encryption, no executor
 * types) so it can be unit-tested in isolation and imported from either the
 * server run route or the block-editor proxy route.
 *
 * Shapes are validated against the Claude Platform docs:
 * https://platform.claude.com/docs/en/managed-agents/
 */

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com'
export const ANTHROPIC_VERSION = '2023-06-01'
/** Beta header for every session/agent/environment/vault endpoint. */
export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01'
/**
 * Memory-store endpoints require a DIFFERENT beta header, and combining it
 * with {@link MANAGED_AGENTS_BETA} on the same request is a documented 400.
 * https://platform.claude.com/docs/en/managed-agents/memory
 */
export const AGENT_MEMORY_BETA = 'agent-memory-2026-07-22'

/**
 * Minimal shape of a session event as delivered over SSE or the events list.
 * The run loop only reads these fields, so we model them structurally rather
 * than exhaustively.
 */
export interface AnthropicSessionEvent {
  id?: string
  type?: string
  content?: Array<{ type: string; text?: string }>
  name?: string
  stop_reason?: { type?: string }
  error?: { message?: string }
  message?: string
  /** Server-side record time; `null`/absent means still queued (handled after processed events). */
  processed_at?: string | null
}

/**
 * Shared inputs on every managed-agents call. `apiKey` is the caller's
 * Claude Platform API key (an Anthropic workspace-scoped key); `signal`
 * propagates cancellation into the outbound fetch.
 */
export interface SessionAuth {
  apiKey: string
  signal?: AbortSignal
}

export interface CreateSessionInput extends SessionAuth {
  agentId: string
  environmentId: string
  /**
   * Environment execution model. Self-hosted environments reject the
   * `resources` array, so memory is routed via `metadata` and files are
   * dropped for them. Defaults to cloud behavior when unset.
   */
  environmentType?: EnvironmentType
  /** Optional session title stored on the Anthropic session. */
  title?: string
  /** OAuth credential vaults the agent's MCP tools can reference. */
  vaultIds?: string[]
  /** Memory-store id (`memstore_...`) attached as a session resource. */
  memoryStoreId?: string
  /** Access mode on the attached memory store. Ignored when `memoryStoreId` is unset. */
  memoryAccess?: 'read_write' | 'read_only'
  /** Per-attachment guidance rendered into the memory section of the system prompt. */
  memoryInstructions?: string
  /** Files-API files (`file_...`) attached as `file` session resources. */
  files?: Array<{ fileId: string; mountPath?: string }>
  /** Arbitrary session metadata (wire name: `metadata`). */
  sessionParameters?: Record<string, string>
}

export interface CreateSessionResult {
  id: string
}

/** Cumulative token usage returned on the session resource. */
export interface SessionUsage {
  inputTokens?: number
  outputTokens?: number
}

/** Environment execution model per `GET /v1/environments/{id}` → `config.type`. */
export type EnvironmentType = 'cloud' | 'self_hosted'

/** Authoritative session status per `GET /v1/sessions/{id}`. */
export type SessionStatus = 'idle' | 'running' | 'rescheduling' | 'terminated'

export interface SessionSnapshot {
  status?: SessionStatus
  usage?: SessionUsage
}

/**
 * Standard header set for Managed Agents calls. `beta` overrides the default
 * managed-agents beta for memory-store endpoints. Only ONE beta value is ever
 * sent — combining the two is a documented 400.
 */
function managedAgentsHeaders(
  apiKey: string,
  options: { json?: boolean; accept?: string; beta?: string } = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': options.beta ?? MANAGED_AGENTS_BETA,
  }
  if (options.json) headers['content-type'] = 'application/json'
  if (options.accept) headers.accept = options.accept
  return headers
}

/**
 * Builds the request body for `POST /v1/sessions`.
 *
 * Cloud environments attach memory stores and files via the `resources[]`
 * array. Self-hosted environments REJECT `resources` (a documented 400 —
 * "resources are not supported with self-hosted environments") and have no
 * native memory/file attach, so those are omitted there; the block hides the
 * fields accordingly. Session parameters always go on `metadata` for both — a
 * self-hosted worker that consumes a memory store reads it from a metadata key
 * the author sets explicitly.
 */
export function buildSessionCreatePayload(input: CreateSessionInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    agent: input.agentId,
    environment_id: input.environmentId,
  }
  if (input.title) payload.title = input.title
  if (input.vaultIds && input.vaultIds.length > 0) payload.vault_ids = input.vaultIds

  // `resources` (memory stores + files) are cloud-only. Self-hosted rejects them.
  if (input.environmentType !== 'self_hosted') {
    const resources: Array<Record<string, unknown>> = []
    if (input.memoryStoreId) {
      const memory: Record<string, unknown> = {
        type: 'memory_store',
        memory_store_id: input.memoryStoreId,
        access: input.memoryAccess ?? 'read_write',
      }
      if (input.memoryInstructions) memory.instructions = input.memoryInstructions
      resources.push(memory)
    }
    if (input.files && input.files.length > 0) {
      for (const file of input.files) {
        if (!file.fileId) continue
        const entry: Record<string, unknown> = { type: 'file', file_id: file.fileId }
        if (file.mountPath) entry.mount_path = file.mountPath
        resources.push(entry)
      }
    }
    if (resources.length > 0) payload.resources = resources
  }

  if (input.sessionParameters && Object.keys(input.sessionParameters).length > 0) {
    payload.metadata = { ...input.sessionParameters }
  }
  return payload
}

/**
 * POST /v1/sessions — provisions a session sandbox. Does NOT start work; a
 * subsequent `sendUserMessage` is what causes the agent to run.
 */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions`, {
    method: 'POST',
    headers: managedAgentsHeaders(input.apiKey, { json: true }),
    body: JSON.stringify(buildSessionCreatePayload(input)),
    signal: input.signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic sessions.create failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
  const body = (await resp.json()) as { id?: unknown }
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error('Anthropic sessions.create returned no id')
  }
  return { id: body.id }
}

interface UserMessageEvent {
  type: 'user.message'
  content: Array<{ type: 'text'; text: string }>
}

interface UserCustomToolResultEvent {
  type: 'user.custom_tool_result'
  custom_tool_use_id: string
  content: Array<{ type: 'text'; text: string }>
  is_error: boolean
}

/** Stops a running session mid-execution; the session stays usable afterward. */
interface UserInterruptEvent {
  type: 'user.interrupt'
}

export type OutboundSessionEvent = UserMessageEvent | UserCustomToolResultEvent | UserInterruptEvent

/** POST /v1/sessions/{id}/events with a single `user.message`. */
export async function sendUserMessage(
  input: SessionAuth & { sessionId: string; text: string }
): Promise<void> {
  await sendSessionEvents({
    apiKey: input.apiKey,
    signal: input.signal,
    sessionId: input.sessionId,
    events: [{ type: 'user.message', content: [{ type: 'text', text: input.text }] }],
  })
}

/** Generic events-send used for both `user.message` and `user.custom_tool_result`. */
export async function sendSessionEvents(
  input: SessionAuth & { sessionId: string; events: OutboundSessionEvent[] }
): Promise<void> {
  if (input.events.length === 0) return
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}/events`, {
    method: 'POST',
    headers: managedAgentsHeaders(input.apiKey, { json: true }),
    body: JSON.stringify({ events: input.events }),
    signal: input.signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic events.send failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
}

/** Best-effort timeout for the fire-on-cancel interrupt (its own, since the run signal is already aborted). */
const INTERRUPT_TIMEOUT_MS = 5000

/**
 * POST /v1/sessions/{id}/events with a `user.interrupt` — stops a session that
 * is still running so it stops consuming the workspace API key once Sim has
 * given up on it (workflow cancelled or wall-clock cap hit). Deliberately uses
 * its OWN short timeout rather than the run's abort signal, which is already
 * aborted by the time this fires.
 */
export async function interruptSession(input: {
  apiKey: string
  sessionId: string
}): Promise<void> {
  await sendSessionEvents({
    apiKey: input.apiKey,
    sessionId: input.sessionId,
    events: [{ type: 'user.interrupt' }],
    signal: AbortSignal.timeout(INTERRUPT_TIMEOUT_MS),
  })
}

/** GET /v1/sessions/{id}/events/stream — opens the SSE response. */
export async function openSessionStream(
  input: SessionAuth & { sessionId: string }
): Promise<Response> {
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}/events/stream`, {
    method: 'GET',
    headers: managedAgentsHeaders(input.apiKey, { accept: 'text/event-stream' }),
    signal: input.signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic events.stream failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
  if (!resp.body) throw new Error('Anthropic events.stream returned no body')
  return resp
}

/** A single page of a Managed Agents list endpoint (page-cursor pagination). */
interface AnthropicListPage<T> {
  data?: T[]
  next_page?: string | null
}

/**
 * Drains a page-cursor-paginated list endpoint (`?limit=&page=` following
 * `next_page` until null). Used for both the block-editor dropdowns and the
 * session-event catch-up. `beta` overrides the default header for memory
 * stores.
 */
const MAX_LIST_PAGES = 1000

async function listPaginated<T>(
  input: SessionAuth & { path: string; beta?: string; maxItems?: number }
): Promise<T[]> {
  const collected: T[] = []
  const maxItems = input.maxItems ?? 2000
  let page: string | null = null
  // `MAX_LIST_PAGES` bounds a misbehaving cursor that never returns `next_page:
  // null`; real histories terminate well before it.
  for (let pageCount = 0; pageCount < MAX_LIST_PAGES && collected.length < maxItems; pageCount++) {
    const url = new URL(`${ANTHROPIC_API_BASE}${input.path}`)
    url.searchParams.set('limit', '100')
    if (page) url.searchParams.set('page', page)
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: managedAgentsHeaders(input.apiKey, { beta: input.beta }),
      signal: input.signal,
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`Anthropic ${input.path} failed (${resp.status}): ${detail.slice(0, 400)}`)
    }
    const body = (await resp.json()) as AnthropicListPage<T>
    const items = Array.isArray(body.data) ? body.data : []
    collected.push(...items)
    if (!body.next_page || items.length === 0) break
    page = body.next_page
  }
  return collected
}

/**
 * Full event history for a session (`GET /v1/sessions/{id}/events`), used by
 * the reconnect/catch-up loop to recover events missed while the SSE stream
 * was closed. The caller dedups against already-seen event ids. Drains every
 * page so the tail (terminal status / final assistant text) is never cut off
 * by a page cap.
 */
export async function listSessionEvents(
  input: SessionAuth & { sessionId: string }
): Promise<AnthropicSessionEvent[]> {
  const events = await listPaginated<AnthropicSessionEvent>({
    apiKey: input.apiKey,
    signal: input.signal,
    path: `/v1/sessions/${input.sessionId}/events`,
    maxItems: Number.POSITIVE_INFINITY,
  })
  // The list endpoint's page order is not guaranteed chronological, so order by
  // the server-side `processed_at` timestamp before returning. The catch-up
  // loop depends on ascending order both to accumulate assistant text in order
  // and to read the latest lifecycle event. Still-queued events (null
  // `processed_at`) are processed after everything else, so they sort last.
  return events.sort((a, b) => parseProcessedAt(a.processed_at) - parseProcessedAt(b.processed_at))
}

/** Epoch millis for a `processed_at`, or +Infinity when absent/queued/unparseable (sorts last). */
function parseProcessedAt(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

/**
 * Lists a Managed Agents resource collection for the block-editor dropdowns.
 * Memory stores require the agent-memory beta header; everything else uses the
 * managed-agents beta.
 */
export async function managedAgentsList<T>(
  input: SessionAuth & { path: string; beta?: string }
): Promise<T[]> {
  return listPaginated<T>({
    apiKey: input.apiKey,
    signal: input.signal,
    path: input.path,
    beta: input.beta,
  })
}

/**
 * GET /v1/environments/{id} — resolves the environment's execution model from
 * `config.type`. Drives session-payload routing: self-hosted rejects
 * `resources`. Returns `undefined` on any error so the caller can fall back to
 * cloud behavior.
 */
export async function getEnvironmentType(
  input: SessionAuth & { environmentId: string }
): Promise<EnvironmentType | undefined> {
  try {
    const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/environments/${input.environmentId}`, {
      method: 'GET',
      headers: managedAgentsHeaders(input.apiKey),
      signal: input.signal,
    })
    if (!resp.ok) return undefined
    const body = (await resp.json()) as { config?: { type?: unknown } }
    const type = body.config?.type
    return type === 'cloud' || type === 'self_hosted' ? type : undefined
  } catch {
    return undefined
  }
}

/**
 * GET /v1/sessions/{id} — retrieves the session resource. Returns the
 * authoritative `status` (used to decide completion when the event stream is
 * quiet) and cumulative token `usage` (surfaced as block output). Returns
 * `null` on any error so callers can treat it as best-effort.
 */
export async function getSession(
  input: SessionAuth & { sessionId: string }
): Promise<SessionSnapshot | null> {
  try {
    const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}`, {
      method: 'GET',
      headers: managedAgentsHeaders(input.apiKey),
      signal: input.signal,
    })
    if (!resp.ok) return null
    const body = (await resp.json()) as {
      status?: unknown
      usage?: { input_tokens?: unknown; output_tokens?: unknown }
    }
    const snapshot: SessionSnapshot = {}
    if (
      body.status === 'idle' ||
      body.status === 'running' ||
      body.status === 'rescheduling' ||
      body.status === 'terminated'
    ) {
      snapshot.status = body.status
    }
    const usage: SessionUsage = {}
    if (typeof body.usage?.input_tokens === 'number') usage.inputTokens = body.usage.input_tokens
    if (typeof body.usage?.output_tokens === 'number') usage.outputTokens = body.usage.output_tokens
    if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) snapshot.usage = usage
    return snapshot
  } catch {
    return null
  }
}
