/**
 * Provider-neutral HTTP client for the Claude Platform Managed Agents API.
 *
 * Two consumers today:
 * 1. `apps/sim/lib/copilot/request/lifecycle/managed-agent-leg.ts` — the copilot
 *    home-chat integration; layers mothership-envelope translation, Sim tool
 *    dispatch, and Redis buffering on top of these primitives.
 * 2. `apps/sim/tools/managed_agent/run_session.ts` (workflow-block tool) — calls
 *    these primitives directly and returns the accumulated assistant text as
 *    the block output. No envelope translation, no Sim-side tool dispatch.
 *
 * This module intentionally has NO Sim-domain dependencies (no `@sim/db`, no
 * copilot buffer, no mothership stream types). It's a thin wrapper around
 * `fetch` that speaks the Managed Agents beta.
 */

import type {
  AnthropicAgentCustomToolUseEvent,
  AnthropicSessionEvent,
} from '@/lib/copilot/request/lifecycle/event-translator'

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com'
export const ANTHROPIC_VERSION = '2023-06-01'
export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01'

/** Environment `config.type` per `GET /v1/environments/{id}`. */
export type ManagedAgentEnvType = 'cloud' | 'self_hosted'

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
  /** Optional session title stored on the Anthropic session. */
  title?: string
  /**
   * OAuth credential vaults the agent's MCP tools can reference. See
   * https://platform.claude.com/docs/en/managed-agents/vaults.
   */
  vaultIds?: string[]
  /**
   * Memory-store id (`memstore_...`). Routing depends on `envType`:
   *   - `cloud`: attached as a `memory_store` session resource
   *     (`resources: [{ type: 'memory_store', memory_store_id, access }]`).
   *   - `self_hosted`: forwarded via `metadata.memory_store_ids` so the
   *     self-hosted agent sandbox can expose it as an env var and
   *     mount the store on its side.
   */
  memoryStoreId?: string
  /**
   * Access mode on the attached memory store — `read_write` (default)
   * pushes changes back on session exit; `read_only` never writes.
   * Cloud path: encoded on the resource entry. Self-hosted path:
   * forwarded as `metadata.memory_access`. Ignored when `memoryStoreId`
   * is unset.
   */
  memoryAccess?: 'read_write' | 'read_only'
  /**
   * File attachments (cloud envs only — the Managed Agents `resources`
   * array accepts entries of type `file`). Each mounts a Files-API
   * file into the session container. `mountPath` is optional; Anthropic
   * picks a default when omitted. Ignored for self-hosted envs.
   */
  files?: Array<{ fileId: string; mountPath?: string }>
  /**
   * Arbitrary session metadata. Wire name: `metadata` (top-level on
   * `POST /v1/sessions`). On self-hosted envs the self-hosted agent
   * sandbox forwards each key to an env var; on cloud envs the keys
   * are stored as opaque tags — safe to send from either block.
   */
  sessionParameters?: Record<string, string>
  /** `cloud` or `self_hosted`. Routes memory + resources correctly. */
  envType?: ManagedAgentEnvType
}

export interface CreateSessionResult {
  id: string
}

/**
 * POST /v1/sessions — provisions a session sandbox. Does NOT start work; a
 * subsequent `sendUserMessage` (or `sendSessionEvents`) is what causes the
 * agent to run. This mirrors the docs' two-step lifecycle:
 * https://platform.claude.com/docs/en/managed-agents/sessions#creating-a-session
 */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  const payload = buildSessionCreatePayload(input)
  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/sessions`, {
    method: 'POST',
    headers: managedAgentsHeaders(input.apiKey, { json: true }),
    body: JSON.stringify(payload),
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

/**
 * Builds the request body for `POST /v1/sessions` from the caller's typed
 * inputs. Keeps the env-type routing in ONE place so callers can't
 * accidentally leak self-hosted-only fields onto a cloud session or vice
 * versa. Any future rename of the session-parameters wire field is a
 * one-line change here.
 */
export function buildSessionCreatePayload(
  input: CreateSessionInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    agent: input.agentId,
    environment_id: input.environmentId,
  }
  if (input.title) payload.title = input.title
  if (input.vaultIds && input.vaultIds.length > 0) payload.vault_ids = input.vaultIds

  const isSelfHosted = input.envType === 'self_hosted'
  const access = input.memoryAccess ?? 'read_write'

  if (isSelfHosted) {
    // Self-hosted: memory + user-supplied metadata both live under
    // top-level `metadata`. The self-hosted agent sandbox forwards
    // keys to env vars.
    const metadata: Record<string, string> = { ...(input.sessionParameters ?? {}) }
    if (input.memoryStoreId && !metadata.memory_store_ids) {
      metadata.memory_store_ids = input.memoryStoreId
      if (!metadata.memory_access) metadata.memory_access = access
    }
    if (Object.keys(metadata).length > 0) payload.metadata = metadata
    // `files` and `resources` are intentionally NOT forwarded for
    // self-hosted — the self-hosted agent sandbox owns any resource
    // mounting on its side.
  } else {
    // Cloud: build resources[] (memory + file) and emit user metadata as
    // opaque tags. Both are optional.
    const resources: Array<Record<string, unknown>> = []
    if (input.memoryStoreId) {
      resources.push({
        type: 'memory_store',
        memory_store_id: input.memoryStoreId,
        access,
      })
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
    if (input.sessionParameters && Object.keys(input.sessionParameters).length > 0) {
      payload.metadata = { ...input.sessionParameters }
    }
  }
  return payload
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

export type OutboundSessionEvent = UserMessageEvent | UserCustomToolResultEvent

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

/** GET /v1/sessions/{id}/events/stream — opens the SSE response. */
export async function openSessionStream(
  input: SessionAuth & { sessionId: string }
): Promise<Response> {
  const resp = await fetch(
    `${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}/events/stream`,
    {
      method: 'GET',
      headers: managedAgentsHeaders(input.apiKey, { accept: 'text/event-stream' }),
      signal: input.signal,
    }
  )
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Anthropic events.stream failed (${resp.status}): ${detail.slice(0, 400)}`)
  }
  if (!resp.body) {
    throw new Error('Anthropic events.stream returned no body')
  }
  return resp
}

const DEFAULT_MAX_EVENTS_PER_CATCHUP = 500

/**
 * Paginated pull of session events emitted after `afterId`, following
 * `has_more` cursors up to `maxEvents` (default 500). Returns events in
 * arrival order. Used by callers that want to reconcile after an SSE
 * stream closes before a terminal state — the copilot leg's reconnect
 * loop is the canonical consumer.
 */
export async function listEventsAfter(
  input: SessionAuth & {
    sessionId: string
    afterId: string | null
    maxEvents?: number
  }
): Promise<AnthropicSessionEvent[]> {
  const collected: AnthropicSessionEvent[] = []
  const maxEvents = input.maxEvents ?? DEFAULT_MAX_EVENTS_PER_CATCHUP
  let cursor: string | null = input.afterId
  while (collected.length < maxEvents) {
    const url = new URL(`${ANTHROPIC_API_BASE}/v1/sessions/${input.sessionId}/events`)
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('after_id', cursor)
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: managedAgentsHeaders(input.apiKey),
      signal: input.signal,
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`Anthropic events.list failed (${resp.status}): ${detail.slice(0, 400)}`)
    }
    const body = (await resp.json()) as {
      data?: AnthropicSessionEvent[]
      has_more?: boolean
      last_id?: string
    }
    const page = Array.isArray(body.data) ? body.data : []
    collected.push(...page)
    if (!body.has_more || page.length === 0) break
    cursor = body.last_id ?? page[page.length - 1]?.id ?? null
    if (!cursor) break
  }
  return collected
}

/**
 * Standard header set for every Managed Agents call. Kept in one place so
 * a beta-version bump (e.g. `managed-agents-2026-05-01`) is a single
 * literal change.
 */
function managedAgentsHeaders(
  apiKey: string,
  options: { json?: boolean; accept?: string } = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': MANAGED_AGENTS_BETA,
  }
  if (options.json) headers['content-type'] = 'application/json'
  if (options.accept) headers.accept = options.accept
  return headers
}

export type { AnthropicSessionEvent, AnthropicAgentCustomToolUseEvent }
