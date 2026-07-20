import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { readSSEEvents } from '@/lib/core/utils/sse'
import {
  type AnthropicSessionEvent,
  type CreateSessionInput,
  createSession,
  listSessionEvents,
  openSessionStream,
  sendSessionEvents,
  sendUserMessage,
} from '@/lib/managed-agents/session-client'

/**
 * Runs a Claude Platform Managed Agent session end-to-end and returns the
 * accumulated assistant text. This is the one genuinely-custom piece of the
 * integration: the Managed Agents lifecycle is create → send → stream →
 * catch-up → reconnect, which the single-request tool framework can't model.
 *
 * The reconnect/catch-up loop follows the documented pattern: on each stream
 * (re)open, reconcile against the full event history and skip already-seen
 * event ids. Pure with respect to Sim (no `@sim/db`, no executor types) — the
 * caller supplies the decrypted API key and normalized inputs.
 */

const logger = createLogger('ManagedAgentRunSession')

/** Upper bound on stream-close → catch-up → reopen cycles per invocation. */
const MAX_RECONNECT_ITERATIONS = 60

/**
 * Backoff for polling while the session is legitimately busy (server-side /
 * MCP tools stay in `requires_action` with no client-visible events until
 * they finish).
 */
const REQUIRES_ACTION_BACKOFF_START_MS = 500
const REQUIRES_ACTION_BACKOFF_MAX_MS = 5000
/** Hard cap on total time spent waiting on a busy session — ~5 minutes. */
const MAX_REQUIRES_ACTION_WAIT_MS = 5 * 60 * 1000

export interface RunManagedAgentInput {
  apiKey: string
  agentId: string
  environmentId: string
  userMessage: string
  title?: string
  vaultIds?: string[]
  memoryStoreId?: string
  memoryAccess?: 'read_write' | 'read_only'
  fileIds?: string[]
  sessionParameters?: Record<string, string>
  signal?: AbortSignal
}

export interface RunManagedAgentResult {
  ok: boolean
  content: string
  sessionId?: string
  error?: string
}

export async function runManagedAgentSession(
  input: RunManagedAgentInput
): Promise<RunManagedAgentResult> {
  const { apiKey, signal } = input
  if (signal?.aborted) return { ok: false, content: '', error: 'aborted' }

  const userMessage = input.userMessage.trim()
  if (!userMessage) return { ok: false, content: '', error: 'User message is required.' }

  const createInput: CreateSessionInput = {
    apiKey,
    agentId: input.agentId,
    environmentId: input.environmentId,
    ...(input.title ? { title: input.title } : {}),
    ...(input.vaultIds && input.vaultIds.length > 0 ? { vaultIds: input.vaultIds } : {}),
    ...(input.memoryStoreId ? { memoryStoreId: input.memoryStoreId } : {}),
    ...(input.memoryStoreId && input.memoryAccess ? { memoryAccess: input.memoryAccess } : {}),
    ...(input.fileIds && input.fileIds.length > 0 ? { fileIds: input.fileIds } : {}),
    ...(input.sessionParameters && Object.keys(input.sessionParameters).length > 0
      ? { sessionParameters: input.sessionParameters }
      : {}),
    ...(signal ? { signal } : {}),
  }

  let sessionId: string
  try {
    const session = await createSession(createInput)
    sessionId = session.id
  } catch (error) {
    return {
      ok: false,
      content: '',
      error: getErrorMessage(error, 'Failed to create Managed Agent session'),
    }
  }

  logger.info('Created managed agent session', {
    sessionId,
    agentId: input.agentId,
    environmentId: input.environmentId,
  })

  try {
    await sendUserMessage({ apiKey, sessionId, text: userMessage, signal })
  } catch (error) {
    return {
      ok: false,
      content: '',
      sessionId,
      error: signal?.aborted ? 'aborted' : getErrorMessage(error, 'Failed to send user message'),
    }
  }

  const assistantText = { value: '' }
  const seenIds = new Set<string>()
  const eventState: EventState = {
    requiresActionEnteredAt: 0,
    currentBackoffMs: REQUIRES_ACTION_BACKOFF_START_MS,
  }
  let terminal: { status: 'complete' | 'error'; reason?: string } | null = null

  try {
    for (let iteration = 0; iteration < MAX_RECONNECT_ITERATIONS && !terminal; iteration++) {
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
          if (event.id && seenIds.has(event.id)) return undefined
          if (event.id) seenIds.add(event.id)
          const outcome = await handleEvent({ event, assistantText, apiKey, sessionId, eventState })
          if (outcome) {
            terminal = outcome
            return true
          }
          return undefined
        },
      })

      if (terminal || signal?.aborted) break

      // Stream closed without a terminal event. Reconcile against the full
      // event history, processing anything the stream missed, then reopen.
      const history = await listSessionEvents({ apiKey, sessionId, signal })
      const unseen = history.filter((event) => !(event.id && seenIds.has(event.id)))
      if (unseen.length === 0) {
        // Nothing new. If a `requires_action` is outstanding the session is
        // legitimately busy (a server-side / MCP tool is running); back off
        // and re-poll. Otherwise it's a clean completion.
        if (eventState.requiresActionEnteredAt > 0) {
          const waitedMs = Date.now() - eventState.requiresActionEnteredAt
          if (waitedMs >= MAX_REQUIRES_ACTION_WAIT_MS) {
            terminal = {
              status: 'error',
              reason: `Session paused (requires_action) for over ${Math.floor(
                MAX_REQUIRES_ACTION_WAIT_MS / 1000
              )}s without progress. Check MCP server / vault configuration on Claude Platform.`,
            }
            break
          }
          await sleep(nextBackoffMs(eventState))
          continue
        }
        terminal = { status: 'complete' }
        break
      }
      // Progress — reset the requires_action wait clock and backoff.
      eventState.requiresActionEnteredAt = 0
      eventState.currentBackoffMs = REQUIRES_ACTION_BACKOFF_START_MS
      for (const event of unseen) {
        if (event.id) seenIds.add(event.id)
        const outcome = await handleEvent({ event, assistantText, apiKey, sessionId, eventState })
        if (outcome) {
          terminal = outcome
          break
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      return { ok: false, content: assistantText.value, sessionId, error: 'aborted' }
    }
    logger.error('Managed agent stream failed', { sessionId, error: getErrorMessage(error) })
    return {
      ok: false,
      content: assistantText.value,
      sessionId,
      error: getErrorMessage(error, 'Managed Agent session failed'),
    }
  }

  if (signal?.aborted) {
    return { ok: false, content: assistantText.value, sessionId, error: 'aborted' }
  }
  if (!terminal || terminal.status === 'error') {
    return {
      ok: false,
      content: assistantText.value,
      sessionId,
      error: terminal?.reason ?? 'Reconnect iteration cap reached without a terminal state.',
    }
  }
  return { ok: true, content: assistantText.value, sessionId }
}

/** Tracks progress across `requires_action` idle events. */
interface EventState {
  /**
   * Timestamp of the first `requires_action` in the current busy stretch, or 0
   * when the session is not paused. Reset to 0 on any progress so a completed
   * turn never re-triggers the busy-wait timeout.
   */
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

  if (event.type === 'agent.message') {
    if (Array.isArray(event.content)) {
      for (const block of event.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          assistantText.value += block.text
        }
      }
    }
    return null
  }

  if (event.type === 'agent.custom_tool_use') {
    logger.warn(
      `Managed Agent invoked a custom tool "${event.name ?? '<unknown>'}" that Sim does not provide — replying with error`
    )
    try {
      await sendSessionEvents({
        apiKey,
        sessionId,
        events: [
          {
            type: 'user.custom_tool_result',
            custom_tool_use_id: event.id ?? '',
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
    } catch (err) {
      logger.error('Failed to send custom_tool_result error reply', {
        sessionId,
        error: getErrorMessage(err),
      })
    }
    return null
  }

  if (event.type === 'session.status_terminated') {
    return { status: 'error', reason: event.error?.message ?? 'session_terminated' }
  }

  if (event.type === 'session.status_idle') {
    const stop = event.stop_reason?.type
    if (stop === 'requires_action') {
      if (eventState.requiresActionEnteredAt === 0) eventState.requiresActionEnteredAt = Date.now()
      return null
    }
    if (stop === 'retries_exhausted') return { status: 'error', reason: 'retries_exhausted' }
    // Any other idle (end_turn, or an unspecified stop reason) means the agent
    // finished its turn — treat as a clean completion, matching the documented
    // "break on session.status_idle" streaming pattern.
    return { status: 'complete' }
  }

  if (event.type === 'session.error') {
    return { status: 'error', reason: event.error?.message ?? event.message ?? 'session_error' }
  }

  return null
}
