import { isRecordLike } from '@sim/utils/object'
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
  /** Tool input, present on `agent.*_tool_use` events. */
  input?: unknown
  /**
   * On `session.status_idle`. When `type` is `requires_action`, `event_ids`
   * lists the blocking tool-use event ids awaiting a `user.tool_confirmation`
   * or `user.custom_tool_result`.
   */
  stop_reason?: { type?: string; event_ids?: string[] }
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
   * Seeds `initial_events` with a single `user.message`, starting the agent
   * loop in the same call — the session is created directly in `running`
   * instead of passing through `idle`. Only `user.message` and
   * `user.define_outcome` are accepted there, and validation is all-or-nothing.
   * https://platform.claude.com/docs/en/managed-agents/sessions
   */
  initialMessage?: string
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

/** Why an idle session stopped, per the session resource / idle event. */
export interface SessionStopReason {
  type?: string
  /** Blocking tool-use event ids when `type` is `requires_action`. */
  eventIds?: string[]
}

export interface SessionSnapshot {
  status?: SessionStatus
  usage?: SessionUsage
  /** Present once the session has stopped at least once. */
  stopReason?: SessionStopReason
  /** Session metadata as stored on the Anthropic session. */
  metadata?: Record<string, string>
  title?: string
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

  // An empty/whitespace `initial_events` entry would be rejected, and an empty
  // array is equivalent to omitting the field — so only seed a real message.
  const initialMessage = input.initialMessage?.trim()
  if (initialMessage) {
    payload.initial_events = [
      { type: 'user.message', content: [{ type: 'text', text: initialMessage }] },
    ]
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

/**
 * Answers one `always_ask` permission gate.
 *
 * `tool_use_id` is the *event id* of the blocking `agent.tool_use` /
 * `agent.mcp_tool_use` event (the ids listed in the idle event's
 * `stop_reason.event_ids`) — NOT a `toolu_...` id. The denial reason field is
 * `deny_message`, and it is only meaningful with `result: 'deny'`.
 * https://platform.claude.com/docs/en/managed-agents/permission-policies
 */
interface UserToolConfirmationEvent {
  type: 'user.tool_confirmation'
  tool_use_id: string
  result: ToolConfirmationResult
  deny_message?: string
}

export type ToolConfirmationResult = 'allow' | 'deny'

export type OutboundSessionEvent =
  | UserMessageEvent
  | UserCustomToolResultEvent
  | UserInterruptEvent
  | UserToolConfirmationEvent

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

/**
 * POST /v1/sessions/{id}/events with one `user.tool_confirmation` per blocking
 * gate. Several confirmations may be sent in a single request, which is why
 * this takes a list — answering all of a turn's gates at once avoids a partial
 * resolve that leaves the session parked.
 */
export async function sendToolConfirmations(
  input: SessionAuth & {
    sessionId: string
    confirmations: Array<{
      toolUseId: string
      result: ToolConfirmationResult
      denyMessage?: string
    }>
  }
): Promise<void> {
  const events: OutboundSessionEvent[] = input.confirmations.map((confirmation) => ({
    type: 'user.tool_confirmation',
    tool_use_id: confirmation.toolUseId,
    result: confirmation.result,
    // `deny_message` is only meaningful on a denial; the API ignores it on an
    // allow, but sending it would misrepresent the intent in the event history.
    ...(confirmation.result === 'deny' && confirmation.denyMessage
      ? { deny_message: confirmation.denyMessage }
      : {}),
  }))
  await sendSessionEvents({
    apiKey: input.apiKey,
    ...(input.signal ? { signal: input.signal } : {}),
    sessionId: input.sessionId,
    events,
  })
}

/**
 * How a blocking gate must be answered.
 *
 * `confirmation` — an `always_ask` permission gate on a server-executed tool;
 * answered with `user.tool_confirmation` (allow/deny).
 * `custom_tool_result` — a client-side custom tool the agent invoked; answered
 * with `user.custom_tool_result` carrying the tool's actual output. Sending a
 * confirmation for one of these does NOT unblock the session.
 */
export type PendingToolGateKind = 'confirmation' | 'custom_tool_result'

/** A tool call blocking a session, resolved to its name/input. */
export interface PendingToolGate {
  /** Event id — pass this as `tool_use_id` / `custom_tool_use_id` when answering. */
  id: string
  /** `agent.tool_use`, `agent.mcp_tool_use`, or `agent.custom_tool_use`. */
  eventType?: string
  /** Which reply event unblocks this gate. Absent when the event could not be resolved. */
  kind?: PendingToolGateKind
  name?: string
  input?: unknown
}

/** Maps a tool-use event type onto the reply event that unblocks it. */
function gateKindFor(eventType: string | undefined): PendingToolGateKind | undefined {
  if (eventType === 'agent.custom_tool_use') return 'custom_tool_result'
  if (eventType === 'agent.tool_use' || eventType === 'agent.mcp_tool_use') return 'confirmation'
  return undefined
}

/** Event types that can block a session pending a client response. */
const TOOL_USE_EVENT_TYPES = [
  'agent.tool_use',
  'agent.mcp_tool_use',
  'agent.custom_tool_use',
] as const

/**
 * Resolves the blocking event ids on an idle `requires_action` session into
 * named gates by cross-referencing the session's tool-use events.
 *
 * The ids alone are enough to answer a gate, so a failure to enrich is NOT an
 * error — the ids are still returned, just without names. Callers get
 * something actionable either way.
 */
export async function resolvePendingToolGates(
  input: SessionAuth & { sessionId: string; eventIds: string[] }
): Promise<PendingToolGate[]> {
  const wanted = new Set(input.eventIds)
  if (wanted.size === 0) return []
  let events: AnthropicSessionEvent[] = []
  try {
    events = await listPaginated<AnthropicSessionEvent>({
      apiKey: input.apiKey,
      ...(input.signal ? { signal: input.signal } : {}),
      path: `/v1/sessions/${input.sessionId}/events`,
      searchParams: TOOL_USE_EVENT_TYPES.map((type): [string, string] => ['types[]', type]),
      // Keep only the events actually being looked up rather than capping the
      // read. A cap would retain the OLDEST page-order events, and blocking
      // gates are by definition the most recent tool calls — exactly the ones a
      // cap would drop. Filtering instead bounds memory to the id count while
      // staying correct however the API orders its pages.
      filter: (event) => Boolean(event.id && wanted.has(event.id)),
      // Every wanted id is found at most once, so once the count matches there
      // is nothing left to look for. Without this the filtered total never
      // reaches any cap and the walk runs to the end of the tool history.
      stopWhen: (found) => found.length >= wanted.size,
    })
  } catch {
    // Enrichment is best-effort — fall through to bare ids below.
  }
  const byId = new Map<string, AnthropicSessionEvent>()
  for (const event of events) {
    if (event.id && wanted.has(event.id) && !byId.has(event.id)) byId.set(event.id, event)
  }
  // Preserve the API's `event_ids` order so the caller's prompts are stable.
  return input.eventIds.map((id) => {
    const event = byId.get(id)
    const kind = gateKindFor(event?.type)
    return {
      id,
      ...(event?.type ? { eventType: event.type } : {}),
      ...(kind ? { kind } : {}),
      ...(event?.name ? { name: event.name } : {}),
      ...(event?.input !== undefined ? { input: event.input } : {}),
    }
  })
}

/**
 * POST /v1/sessions/{id}/events with one `user.custom_tool_result` per pending
 * custom-tool call.
 *
 * Custom tools are executed by the caller, not Anthropic, so a permission
 * confirmation cannot unblock them — the agent is waiting for the tool's actual
 * output (or an error).
 */
export async function sendCustomToolResults(
  input: SessionAuth & {
    sessionId: string
    results: Array<{ customToolUseId: string; content: string; isError?: boolean }>
  }
): Promise<void> {
  const events: OutboundSessionEvent[] = input.results.map((result) => ({
    type: 'user.custom_tool_result',
    custom_tool_use_id: result.customToolUseId,
    content: [{ type: 'text', text: result.content }],
    is_error: result.isError ?? false,
  }))
  await sendSessionEvents({
    apiKey: input.apiKey,
    ...(input.signal ? { signal: input.signal } : {}),
    sessionId: input.sessionId,
    events,
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
  input: SessionAuth & {
    path: string
    beta?: string
    maxItems?: number
    /** Extra repeatable query pairs (e.g. `types[]` filters). */
    searchParams?: Array<[string, string]>
    /**
     * Applied per item as pages arrive, so only matches are retained. Use this
     * instead of `maxItems` when the caller needs specific items rather than a
     * prefix — a cap keeps whatever the API returned first, which is the oldest
     * entries on a chronological endpoint.
     */
    filter?: (item: T) => boolean
    /**
     * Checked after each page against everything collected so far. Lets a
     * filtered read stop as soon as it has what it came for — otherwise
     * `maxItems` never trips (the filtered total stays small) and the walk runs
     * to the end of the history for nothing.
     */
    stopWhen?: (collected: T[]) => boolean
  }
): Promise<T[]> {
  const collected: T[] = []
  const maxItems = input.maxItems ?? 2000
  let page: string | null = null
  // `MAX_LIST_PAGES` bounds a misbehaving cursor that never returns `next_page:
  // null`; real histories terminate well before it.
  for (let pageCount = 0; pageCount < MAX_LIST_PAGES && collected.length < maxItems; pageCount++) {
    const url = new URL(`${ANTHROPIC_API_BASE}${input.path}`)
    url.searchParams.set('limit', '100')
    // `append`, not `set` — `types[]` is repeatable and each value must survive.
    for (const [key, value] of input.searchParams ?? []) url.searchParams.append(key, value)
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
    collected.push(...(input.filter ? items.filter(input.filter) : items))
    if (input.stopWhen?.(collected)) break
    // Paging continues on the RAW page, not the filtered result: a page whose
    // every item was filtered out is not the end of the list.
    if (!body.next_page || items.length === 0) break
    page = body.next_page
  }
  // Pages arrive whole, so the last one can overshoot `maxItems` — trim to the
  // exact cap the caller asked for. (`slice(0, Infinity)` is a no-op, so the
  // unbounded default is unaffected.)
  return collected.length > maxItems ? collected.slice(0, maxItems) : collected
}

/**
 * Full event history for a session (`GET /v1/sessions/{id}/events`), used by
 * the reconnect/catch-up loop to recover events missed while the SSE stream
 * was closed. The caller dedups against already-seen event ids. Drains every
 * page so the tail (terminal status / final assistant text) is never cut off
 * by a page cap.
 */
export async function listSessionEvents(
  input: SessionAuth & {
    sessionId: string
    types?: string[]
    /**
     * Caps how many events are RETURNED. Defaults to unbounded, which is what
     * the run loop's catch-up needs — it must reach the tail to see the terminal
     * event.
     *
     * The cap keeps the MOST RECENT events, not the first ones the API happens
     * to hand back. Capping the fetch instead would return the oldest slice of a
     * long session and silently omit the agent's latest reply — the exact thing
     * most callers are reading events for. Paging is therefore still exhaustive;
     * the bound applies to the returned array.
     */
    maxItems?: number
  }
): Promise<AnthropicSessionEvent[]> {
  return (await listSessionEventsPage(input)).events
}

/** An event read plus the size of the history it was taken from. */
export interface SessionEventPage {
  events: AnthropicSessionEvent[]
  /**
   * How many events the session actually has, before any cap. Compare against
   * `events.length` to tell a capped read from a complete one — a history that
   * happens to be exactly `maxItems` long has dropped nothing.
   */
  total: number
}

/**
 * Same read as {@link listSessionEvents}, but also reports the untrimmed
 * history size so callers can distinguish "this is a tail" from "this is
 * everything, and it happens to be exactly the cap".
 */
export async function listSessionEventsPage(
  input: SessionAuth & { sessionId: string; types?: string[]; maxItems?: number }
): Promise<SessionEventPage> {
  const types = (input.types ?? []).filter((type) => type.trim().length > 0)
  const events = await listPaginated<AnthropicSessionEvent>({
    apiKey: input.apiKey,
    signal: input.signal,
    path: `/v1/sessions/${input.sessionId}/events`,
    ...(types.length > 0
      ? { searchParams: types.map((type): [string, string] => ['types[]', type.trim()]) }
      : {}),
    maxItems: Number.POSITIVE_INFINITY,
  })
  // The list endpoint's page order is not guaranteed chronological, so order by
  // the server-side `processed_at` timestamp before returning. The catch-up
  // loop depends on ascending order both to accumulate assistant text in order
  // and to read the latest lifecycle event. Still-queued events (null
  // `processed_at`) are processed after everything else, so they sort last.
  const ordered = events.sort(
    (a, b) => parseProcessedAt(a.processed_at) - parseProcessedAt(b.processed_at)
  )
  const total = ordered.length
  if (input.maxItems === undefined || Number.isNaN(input.maxItems)) {
    return { events: ordered, total }
  }
  // Floor first: `slice` truncates its index toward zero, so a cap between 0
  // and 1 would become `slice(-0)` — i.e. `slice(0)` — and hand back the ENTIRE
  // history for what the caller asked to be the tightest possible bound. Doing
  // it here means no caller can hit that, whatever it passes.
  const maxItems = Math.floor(input.maxItems)
  if (maxItems <= 0) return { events: [], total }
  if (total <= maxItems) return { events: ordered, total }
  // Slice AFTER ordering so the cap is "the newest N", independent of the order
  // the API returned pages in.
  return { events: ordered.slice(-maxItems), total }
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
    return parseSessionSnapshot(await resp.json())
  } catch {
    return null
  }
}

/**
 * Maps a raw `/v1/sessions/{id}` body onto {@link SessionSnapshot}. Split out
 * so it is directly unit-testable and shared by the best-effort `getSession`
 * and the strict `retrieveSession`.
 */
export function parseSessionSnapshot(raw: unknown): SessionSnapshot {
  const body = (raw ?? {}) as {
    status?: unknown
    title?: unknown
    metadata?: unknown
    usage?: { input_tokens?: unknown; output_tokens?: unknown }
    stop_reason?: { type?: unknown; event_ids?: unknown }
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

  if (body.stop_reason && typeof body.stop_reason === 'object') {
    const stopReason: SessionStopReason = {}
    if (typeof body.stop_reason.type === 'string') stopReason.type = body.stop_reason.type
    if (Array.isArray(body.stop_reason.event_ids)) {
      const eventIds = body.stop_reason.event_ids.filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
      if (eventIds.length > 0) stopReason.eventIds = eventIds
    }
    if (stopReason.type !== undefined || stopReason.eventIds !== undefined) {
      snapshot.stopReason = stopReason
    }
  }

  if (typeof body.title === 'string') snapshot.title = body.title
  if (isRecordLike(body.metadata)) {
    const metadata: Record<string, string> = {}
    for (const [key, value] of Object.entries(body.metadata as Record<string, unknown>)) {
      if (typeof value === 'string') metadata[key] = value
      else if (typeof value === 'number' || typeof value === 'boolean')
        metadata[key] = String(value)
    }
    if (Object.keys(metadata).length > 0) snapshot.metadata = metadata
  }
  return snapshot
}

/**
 * GET /v1/sessions/{id}, but STRICT — throws on a non-2xx instead of returning
 * `null`. The block's Get Session operation reports a missing/unauthorized
 * session as a block error rather than silently yielding an empty result;
 * {@link getSession} keeps its best-effort contract for the run loop.
 */
export async function retrieveSession(
  input: SessionAuth & { sessionId: string }
): Promise<SessionSnapshot> {
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}`, {
    method: 'GET',
    headers: managedAgentsHeaders(input.apiKey),
    signal: input.signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic sessions.get failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
  return parseSessionSnapshot(await resp.json())
}

/**
 * POST /v1/sessions/{id} — updates session `title` and/or `metadata`.
 *
 * `metadata` is a FULL REPLACEMENT of the stored map, matching the API's
 * replace semantics; callers that want to merge must read the session first.
 * The session must be `idle` for agent-config updates; title/metadata updates
 * are not gated that way.
 * https://platform.claude.com/docs/en/managed-agents/session-operations
 */
export async function updateSession(
  input: SessionAuth & {
    sessionId: string
    title?: string
    metadata?: Record<string, string>
  }
): Promise<SessionSnapshot> {
  const payload: Record<string, unknown> = {}
  if (input.title !== undefined) payload.title = input.title
  if (input.metadata !== undefined) payload.metadata = input.metadata
  if (Object.keys(payload).length === 0) {
    throw new Error('Update session requires a title or metadata to change.')
  }
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}`, {
    method: 'POST',
    headers: managedAgentsHeaders(input.apiKey, { json: true }),
    body: JSON.stringify(payload),
    signal: input.signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic sessions.update failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
  return parseSessionSnapshot(await resp.json().catch(() => ({})))
}

/**
 * POST /v1/sessions/{id}/archive — makes the session read-only while
 * preserving its history. A `running` session cannot be archived (interrupt
 * it first), and archiving is NOT reversible.
 */
export async function archiveSession(input: SessionAuth & { sessionId: string }): Promise<void> {
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}/archive`, {
    method: 'POST',
    headers: managedAgentsHeaders(input.apiKey),
    signal: input.signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic sessions.archive failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
}

/**
 * DELETE /v1/sessions/{id} — permanently removes the session record, its
 * events, and its sandbox. A `running` session cannot be deleted (interrupt it
 * first). Files, memory stores, vaults, skills, environments, and agents are
 * independent resources and are NOT affected.
 */
export async function deleteSession(input: SessionAuth & { sessionId: string }): Promise<void> {
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}`, {
    method: 'DELETE',
    headers: managedAgentsHeaders(input.apiKey),
    signal: input.signal,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic sessions.delete failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
}
