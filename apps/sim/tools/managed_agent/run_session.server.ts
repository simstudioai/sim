import 'server-only'

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { readSSEEvents } from '@/lib/core/utils/sse'
import { getDecryptedApiKey } from '@/lib/managed-agents/connections'
import { env } from '@/lib/core/config/env'
import {
  type AnthropicSessionEvent,
  buildSessionCreatePayload,
  createSession,
  listEventsAfter,
  openSessionStream,
  sendSessionEvents,
  sendUserMessage,
} from '@/lib/managed-agents/session-client'
import {
  normalizeEnvType,
  normalizeFiles,
  normalizeMemoryAccess,
  normalizeSessionParameters,
  normalizeStringList,
} from '@/tools/managed_agent/normalizers'
import {
  registerManagedAgentServerImpl,
  type ManagedAgentServerImpl,
} from '@/tools/managed_agent/run_session'
import type {
  ManagedAgentRunSessionOutput,
  ManagedAgentRunSessionParams,
} from '@/tools/managed_agent/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Server-only execution for the Managed Agent workflow-block tool.
 *
 * `import 'server-only'` fails the build if anything in the client
 * graph reaches this file — matching the intent. The client tool
 * skeleton (`./run_session.ts`) uses a `globalThis` lookup to reach
 * this impl at runtime, so Turbopack finds no cross-boundary edge.
 */

const logger = createLogger('ManagedAgentRunSessionServer')

/** Upper bound on stream-close → catch-up → reopen cycles per invocation. */
const MAX_RECONNECT_ITERATIONS = 60

/**
 * Backoff for `listEventsAfter` polling while the session is legitimately
 * busy (server-side / MCP tools stay in `requires_action` with no
 * client-visible events until they finish). Starts at 500ms, doubles up
 * to 5s, capped so a stuck session terminates instead of spinning
 * forever — see MAX_REQUIRES_ACTION_WAIT_MS.
 */
const REQUIRES_ACTION_BACKOFF_START_MS = 500
const REQUIRES_ACTION_BACKOFF_MAX_MS = 5000
/** Hard cap on total time spent waiting on a busy session — ~5 minutes. */
const MAX_REQUIRES_ACTION_WAIT_MS = 5 * 60 * 1000

const impl: ManagedAgentServerImpl = async (
  params: ManagedAgentRunSessionParams
): Promise<ToolResponse> => {
  const startedAt = new Date()
  const context = params._context
  const workspaceId = context?.workspaceId
  // Workflow abort signal — set by `executeTool` on the directExecution
  // path. When the workflow is cancelled we forward this to the stream
  // fetch, the SSE reader, and the catch-up pagination so the HTTP
  // connection is released instead of leaked.
  const signal =
    context && typeof context === 'object' && 'abortSignal' in context
      ? (context as { abortSignal?: AbortSignal }).abortSignal
      : undefined
  if (!workspaceId) {
    return {
      success: false,
      output: {},
      error: 'Missing workspaceId in tool context — is this workflow tied to a workspace?',
    }
  }
  if (signal?.aborted) {
    return { success: false, output: {}, error: 'aborted' }
  }

  const keyResult = await getDecryptedApiKey({ id: params.connection, workspaceId })
  if (!keyResult.ok) {
    return {
      success: false,
      output: {},
      error:
        keyResult.reason === 'decrypt_failed'
          ? 'Managed Agent connection could not be decrypted — the workspace encryption key may have rotated. Rotate the API key in Settings → Managed Agents to re-encrypt.'
          : 'Managed Agent connection not found. Reconnect the Claude workspace and retry.',
    }
  }
  const apiKey = keyResult.apiKey

  if (isPayloadDebugEnabled()) {
    logger.info('Managed agent tool raw params (pre-normalization)', {
      workspaceId,
      vaultsType: Array.isArray(params.vaults) ? 'array' : typeof params.vaults,
      vaultsValue: params.vaults,
      memoryStoreIdValue: params.memoryStoreId,
      filesType: Array.isArray(params.files) ? 'array' : typeof params.files,
      environmentType: params.environmentType,
    })
  }

  const envType = normalizeEnvType(params.environmentType)
  const userMessage = (params.userMessage ?? '').trim()
  if (!userMessage) {
    return { success: false, output: {}, error: 'User message is required.' }
  }

  const vaultIds = normalizeStringList(params.vaults)
  const memoryStoreId = params.memoryStoreId?.trim() || undefined
  const memoryAccess = normalizeMemoryAccess(params.memoryAccess)
  const files = normalizeFiles(params.files)
  const sessionParameters = normalizeSessionParameters(params.sessionParameters)

  const createSessionInput = {
    apiKey,
    agentId: params.agent,
    environmentId: params.environment,
    envType,
    ...(vaultIds.length > 0 ? { vaultIds } : {}),
    ...(memoryStoreId ? { memoryStoreId } : {}),
    ...(memoryStoreId && memoryAccess ? { memoryAccess } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(sessionParameters && Object.keys(sessionParameters).length > 0
      ? { sessionParameters }
      : {}),
    ...(signal ? { signal } : {}),
  }

  // Opt-in payload dump for debugging session-create request shape.
  // Enable with `MANAGED_AGENT_DEBUG_PAYLOAD=1` in `.env` — the log line
  // does NOT include the api key (buildSessionCreatePayload strips it).
  if (isPayloadDebugEnabled()) {
    logger.info('Managed agent session-create payload', {
      workspaceId,
      agentId: params.agent,
      environmentId: params.environment,
      envType,
      payload: buildSessionCreatePayload(createSessionInput),
    })
  }

  let sessionId: string
  try {
    const session = await createSession(createSessionInput)
    sessionId = session.id
  } catch (error) {
    return {
      success: false,
      output: {},
      error: getErrorMessage(error, 'Failed to create Managed Agent session'),
    }
  }

  logger.info('Created managed agent session for workflow block', {
    workspaceId,
    workflowId: context?.workflowId,
    sessionId,
    agentId: params.agent,
    environmentId: params.environment,
    envType,
  })

  try {
    await sendUserMessage({ apiKey, sessionId, text: userMessage, signal })
  } catch (error) {
    return {
      success: false,
      output: { sessionId },
      error: signal?.aborted
        ? 'aborted'
        : getErrorMessage(error, 'Failed to send user message'),
    }
  }

  const assistantText = { value: '' }
  const seenIds = new Set<string>()
  const eventState: EventState = {
    lastCustomToolResponseAt: 0,
    lastRequiresActionAt: 0,
    requiresActionEnteredAt: 0,
    currentBackoffMs: REQUIRES_ACTION_BACKOFF_START_MS,
  }
  let lastEventId: string | null = null
  let terminal: { status: 'complete' | 'error'; reason?: string } | null = null

  try {
    for (
      let iteration = 0;
      iteration < MAX_RECONNECT_ITERATIONS && !terminal;
      iteration++
    ) {
      if (signal?.aborted) break
      const streamResp = await openSessionStream({ apiKey, sessionId, signal })
      await readSSEEvents<AnthropicSessionEvent>(streamResp, {
        signal,
        onParseError: (raw, err) => {
          logger.warn('Un-parseable SSE line', {
            sessionId,
            preview: raw.slice(0, 200),
            error: getErrorMessage(err),
          })
        },
        onEvent: async (event) => {
          const eventId = (event as { id?: string }).id
          if (eventId && seenIds.has(eventId)) return undefined
          if (eventId) {
            seenIds.add(eventId)
            lastEventId = eventId
          }
          const outcome = await handleEvent({
            event,
            assistantText,
            apiKey,
            sessionId,
            eventState,
          })
          if (outcome) {
            terminal = outcome
            return true
          }
          return undefined
        },
      })

      if (terminal) break
      if (signal?.aborted) break

      const missed = await listEventsAfter({ apiKey, sessionId, afterId: lastEventId, signal })
      if (missed.length === 0) {
        // Session went idle with no new events to catch up on. Two cases:
        //   1. `requires_action` is currently outstanding — either we
        //      already sent our tool-result reply and the agent is
        //      processing it, or a server-side / MCP tool is executing
        //      on the platform side. In BOTH cases the session is
        //      legitimately busy; back off and re-poll rather than
        //      failing (server-side tools can stay in requires_action
        //      for tens of seconds with no client-visible events).
        //   2. No pending action → clean completion (usually already
        //      hit via `end_turn` earlier; this is the fallback path).
        if (eventState.lastRequiresActionAt > 0) {
          const waitedMs = Date.now() - eventState.requiresActionEnteredAt
          if (waitedMs >= MAX_REQUIRES_ACTION_WAIT_MS) {
            terminal = {
              status: 'error',
              reason: `Session paused (requires_action) for over ${Math.floor(MAX_REQUIRES_ACTION_WAIT_MS / 1000)}s without progress — the pending tool call could not complete. Check MCP server / vault configuration on Claude Platform.`,
            }
            break
          }
          await sleep(nextBackoffMs(eventState))
          continue
        }
        terminal = { status: 'complete' }
        break
      }
      // Session made progress — reset the requires_action wait clock
      // and backoff so the next pause starts fresh.
      eventState.requiresActionEnteredAt = 0
      eventState.currentBackoffMs = REQUIRES_ACTION_BACKOFF_START_MS
      for (const event of missed) {
        const eventId = (event as { id?: string }).id
        if (eventId && seenIds.has(eventId)) continue
        if (eventId) {
          seenIds.add(eventId)
          lastEventId = eventId
        }
        const outcome = await handleEvent({
          event,
          assistantText,
          apiKey,
          sessionId,
          eventState,
        })
        if (outcome) {
          terminal = outcome
          break
        }
      }
    }
  } catch (error) {
    // A workflow abort surfaces as an AbortError / DOMException here — do
    // not log that as a stream failure, and return a clean 'aborted'
    // response so the executor can attribute cancellation correctly.
    if (signal?.aborted) {
      return {
        success: false,
        output: { sessionId, content: assistantText.value },
        error: 'aborted',
      }
    }
    logger.error('Managed agent stream failed', { sessionId, error: getErrorMessage(error) })
    return {
      success: false,
      output: { sessionId, content: assistantText.value },
      error: getErrorMessage(error, 'Managed Agent session failed'),
    }
  }

  const endedAt = new Date()
  const timing = {
    startTime: startedAt.toISOString(),
    endTime: endedAt.toISOString(),
    duration: endedAt.getTime() - startedAt.getTime(),
  }

  if (signal?.aborted) {
    return {
      success: false,
      output: { sessionId, content: assistantText.value } satisfies ManagedAgentRunSessionOutput,
      error: 'aborted',
      timing,
    }
  }

  if (!terminal || terminal.status === 'error') {
    return {
      success: false,
      output: { sessionId, content: assistantText.value } satisfies ManagedAgentRunSessionOutput,
      error: terminal?.reason ?? 'Reconnect iteration cap reached without a terminal state.',
      timing,
    }
  }

  return {
    success: true,
    output: { sessionId, content: assistantText.value } satisfies ManagedAgentRunSessionOutput,
    timing,
  }
}

/** Side-effect: bind the impl into the process at import time. */
registerManagedAgentServerImpl(impl)

/**
 * Tracks progress across `requires_action` idle events. Server-side or
 * MCP tools can legitimately keep the session in `requires_action` for
 * tens of seconds with no client-visible events; we back off + re-poll
 * `listEventsAfter` rather than treating catch-up silence as failure.
 * `lastCustomToolResponseAt` retains historical use for tests that check
 * "did we reply to a `custom_tool_use`", but the retry policy now applies
 * uniformly regardless.
 */
interface EventState {
  lastCustomToolResponseAt: number
  lastRequiresActionAt: number
  /** Timestamp of the first `requires_action` in the current busy stretch. */
  requiresActionEnteredAt: number
  /** Next backoff to use if we re-poll on catch-up silence. */
  currentBackoffMs: number
}

function nextBackoffMs(state: EventState): number {
  const next = state.currentBackoffMs
  state.currentBackoffMs = Math.min(
    Math.max(next * 2, REQUIRES_ACTION_BACKOFF_START_MS),
    REQUIRES_ACTION_BACKOFF_MAX_MS
  )
  return next
}

async function handleEvent(args: {
  event: AnthropicSessionEvent
  assistantText: { value: string }
  apiKey: string
  sessionId: string
  eventState: EventState
}): Promise<{ status: 'complete' | 'error'; reason?: string } | null> {
  const { event, assistantText, apiKey, sessionId, eventState } = args
  const type = (event as { type?: string }).type

  if (type === 'agent.message') {
    const content = (event as { content?: Array<{ type: string; text?: string }> }).content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          assistantText.value += block.text
        }
      }
    }
    return null
  }

  if (type === 'agent.custom_tool_use') {
    const toolEvent = event as { id: string; name?: string }
    logger.warn(
      `Managed Agent invoked a custom tool "${toolEvent.name ?? '<unknown>'}" that Sim does not provide — replying with error`
    )
    try {
      await sendSessionEvents({
        apiKey,
        sessionId,
        events: [
          {
            type: 'user.custom_tool_result',
            custom_tool_use_id: toolEvent.id,
            content: [
              {
                type: 'text',
                text: 'This Managed Agent is being invoked from a Sim workflow block. Sim does not provide custom tools here — configure the agent to use only tools available in its Claude Platform workspace.',
              },
            ],
            is_error: true,
          },
        ],
      })
      eventState.lastCustomToolResponseAt = Date.now()
    } catch (err) {
      logger.error('Failed to send custom_tool_result error reply', {
        sessionId,
        error: getErrorMessage(err),
      })
    }
    return null
  }

  if (type === 'session.status_terminated') {
    const message =
      (event as { error?: { message?: string } }).error?.message ?? 'session_terminated'
    return { status: 'error', reason: message }
  }

  if (type === 'session.status_idle') {
    const stop = (event as { stop_reason?: { type?: string } }).stop_reason?.type
    if (stop === 'end_turn') return { status: 'complete' }
    if (stop === 'retries_exhausted') return { status: 'error', reason: 'retries_exhausted' }
    if (stop === 'requires_action') {
      // Session paused for a pending action. Never terminal: either
      // (a) we already replied to a `custom_tool_use` and the agent is
      // processing it, or (b) a server-side / MCP tool is executing on
      // the platform side. Both cases resolve on their own; the outer
      // reconnect loop backs off + re-polls `listEventsAfter` until
      // either new events arrive or the total-wait cap is hit.
      const now = Date.now()
      if (eventState.requiresActionEnteredAt === 0) {
        eventState.requiresActionEnteredAt = now
      }
      eventState.lastRequiresActionAt = now
      return null
    }
    return { status: 'error', reason: stop ?? 'idle_without_stop_reason' }
  }

  if (type === 'session.error') {
    const message =
      (event as { error?: { message?: string } }).error?.message ??
      (event as { message?: string }).message ??
      'session_error'
    return { status: 'error', reason: message }
  }

  return null
}

function isPayloadDebugEnabled(): boolean {
  const raw = env.MANAGED_AGENT_DEBUG_PAYLOAD
  if (raw === undefined || raw === null) return false
  const normalized = String(raw).toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}
