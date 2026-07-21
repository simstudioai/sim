import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { readSSEEvents } from '@/lib/core/utils/sse'
import {
  type AnthropicSessionEvent,
  type CreateSessionInput,
  createSession,
  getSession,
  interruptSession,
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
 * Completion is driven only by real terminal signals — a `session.status_idle`
 * (`end_turn`) event, or the authoritative session `status` when the event
 * stream is quiet — never by a heuristic timer. Pure with respect to Sim (no
 * `@sim/db`, no executor types); the caller supplies the decrypted API key.
 */

const logger = createLogger('ManagedAgentRunSession')

/** Upper bound on stream-close → catch-up → reopen cycles per invocation. */
const MAX_RECONNECT_ITERATIONS = 120
/** Wall-clock backstop for the reconnect loop (not the live-stream duration). */
const MAX_SESSION_MS = 15 * 60 * 1000
const RECONNECT_BACKOFF_START_MS = 500
const RECONNECT_BACKOFF_MAX_MS = 5000

export interface RunManagedAgentInput {
  apiKey: string
  agentId: string
  environmentId: string
  userMessage: string
  title?: string
  vaultIds?: string[]
  memoryStoreId?: string
  memoryAccess?: 'read_write' | 'read_only'
  memoryInstructions?: string
  files?: Array<{ fileId: string; mountPath?: string }>
  sessionParameters?: Record<string, string>
  signal?: AbortSignal
}

export interface RunManagedAgentResult {
  ok: boolean
  content: string
  sessionId?: string
  error?: string
  inputTokens?: number
  outputTokens?: number
}

type Terminal = { status: 'complete' | 'error'; reason?: string }
/** Result of handling one event: an optional terminal signal, plus whether the event must be retried. */
type HandleResult = { terminal?: Terminal; retry?: boolean }

/**
 * The most recent lifecycle event (`session.status_*` / `session.error`) in a
 * chronological history, or `undefined`. The events list is authoritative and
 * ordered, so the last such event reflects the session's current state — used
 * to recompute the pending-action state without depending on the order events
 * happened to arrive across the live stream and catch-up.
 */
function findLastLifecycleEvent(
  history: AnthropicSessionEvent[]
): AnthropicSessionEvent | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const type = history[i].type
    if (type && (type.startsWith('session.status_') || type === 'session.error')) {
      return history[i]
    }
  }
  return undefined
}

/** Best-effort `user.interrupt` for a session Sim is abandoning (cancel / cap). Never throws. */
async function interruptQuietly(apiKey: string, sessionId: string): Promise<void> {
  try {
    await interruptSession({ apiKey, sessionId })
  } catch (err) {
    logger.warn('Failed to interrupt managed agent session on cancel', {
      sessionId,
      error: getErrorMessage(err),
    })
  }
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
    ...(input.memoryStoreId && input.memoryInstructions
      ? { memoryInstructions: input.memoryInstructions }
      : {}),
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
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
    // The session exists but we could not drive it. The message may still have
    // reached the sandbox (abort/error can race the delivered request), so stop
    // the session rather than leave it possibly running against the key.
    await interruptQuietly(apiKey, sessionId)
    return {
      ok: false,
      content: '',
      sessionId,
      error: signal?.aborted ? 'aborted' : getErrorMessage(error, 'Failed to send user message'),
    }
  }

  const assistantText = { value: '' }
  const seenIds = new Set<string>()
  const startedAt = Date.now()
  let backoffMs = RECONNECT_BACKOFF_START_MS
  let sawActivity = false
  // A `requires_action` idle is a pending pause (waiting on a tool result), not
  // a finished turn. Tracking it prevents the quiet-status path from reporting
  // an in-progress session complete; it clears once the session resumes.
  let requiresActionOutstanding = false
  let terminal: Terminal | null = null

  const process = async (event: AnthropicSessionEvent): Promise<boolean> => {
    if (
      event.type === 'agent.message' ||
      event.type === 'agent.custom_tool_use' ||
      event.type === 'session.status_running'
    ) {
      sawActivity = true
    }
    if (event.type === 'session.status_running' || event.type === 'agent.message') {
      requiresActionOutstanding = false
    }
    if (event.type === 'session.status_idle' && event.stop_reason?.type === 'requires_action') {
      requiresActionOutstanding = true
    }
    const outcome = await handleEvent({ event, assistantText, apiKey, sessionId, signal })
    // Mark the event seen only once fully handled. A custom-tool reply that
    // failed to send stays unseen so the next catch-up retries it instead of
    // stranding the session on an unanswered requires_action pause.
    if (event.id && !outcome.retry) seenIds.add(event.id)
    if (outcome.terminal) {
      terminal = outcome.terminal
      return true
    }
    return false
  }

  try {
    for (let iteration = 0; iteration < MAX_RECONNECT_ITERATIONS && !terminal; iteration++) {
      if (signal?.aborted) break
      if (Date.now() - startedAt > MAX_SESSION_MS) {
        // Giving up on a session that may still be running — stop it so it
        // does not keep consuming the workspace key past our cap.
        await interruptQuietly(apiKey, sessionId)
        terminal = {
          status: 'error',
          reason: `Session did not reach a terminal state within ${Math.floor(MAX_SESSION_MS / 1000)}s.`,
        }
        break
      }

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
          // Skip idless events — `event_start`/`event_delta` stream previews
          // carry no id, are never persisted, and are never deduped, so
          // accumulating their text would double it once the persisted
          // `agent.message` arrives. Final text always lands as an id-bearing
          // event, so previews add nothing. Mirrors the catch-up loop.
          if (!event.id || seenIds.has(event.id)) return undefined
          return (await process(event)) ? true : undefined
        },
      })
      if (terminal || signal?.aborted) break

      // Stream closed without a terminal event. Reconcile the full event
      // history — the terminal event or final text may have landed during the
      // gap. Events are deduped by id; entries without an id are skipped here
      // (they are non-persisted stream previews, never history).
      const history = await listSessionEvents({ apiKey, sessionId, signal })
      let progressed = false
      for (const event of history) {
        if (!event.id || seenIds.has(event.id)) continue
        const isTerminal = await process(event)
        // Count as progress only when the event was actually consumed (marked
        // seen). A custom-tool reply that failed stays unseen for retry — it
        // must NOT reset the backoff, or a persistently-failing reply would
        // spin the reconnect loop with no delay.
        if (seenIds.has(event.id)) progressed = true
        if (isTerminal) break
      }
      if (terminal || signal?.aborted) break

      // Recompute the pending-action state from the chronological history,
      // which is authoritative and ordered. This overrides any out-of-order
      // flag flip made while processing catch-up events — an older
      // `agent.message` recovered after the live stream must not clear a newer
      // `requires_action` pause and let a still-waiting session report done.
      // Falls back to the stream-tracked flag when the history carries no
      // lifecycle events (e.g. status changes not persisted to the list).
      const lastLifecycle = findLastLifecycleEvent(history)
      if (lastLifecycle) {
        requiresActionOutstanding =
          lastLifecycle.type === 'session.status_idle' &&
          lastLifecycle.stop_reason?.type === 'requires_action'
      }

      // Still no terminal event. Consult the authoritative session status: a
      // finished session reports `idle`/`terminated`; a working one reports
      // `running`. `idle` counts as complete only once the agent has actually
      // started (a freshly-created session is `idle` before its first turn).
      const snapshot = await getSession({ apiKey, sessionId, signal })
      if (snapshot?.status === 'terminated') {
        terminal = { status: 'error', reason: 'Session terminated.' }
        break
      }
      if (snapshot?.status === 'idle' && sawActivity && !requiresActionOutstanding) {
        terminal = { status: 'complete' }
        break
      }

      // Working (or not yet started) — back off and reopen, resetting the
      // backoff whenever catch-up surfaced new events.
      if (progressed) {
        backoffMs = RECONNECT_BACKOFF_START_MS
      } else {
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, RECONNECT_BACKOFF_MAX_MS)
      }
    }
  } catch (error) {
    // Any exit from the loop with the session possibly still running must stop
    // it — a mid-run stream/API failure is no different from an abort or cap.
    await interruptQuietly(apiKey, sessionId)
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
    await interruptQuietly(apiKey, sessionId)
    return { ok: false, content: assistantText.value, sessionId, error: 'aborted' }
  }
  if (!terminal) {
    // Reconnect cap reached while the session may still be running — stop it so
    // it does not keep consuming the workspace key after we give up.
    await interruptQuietly(apiKey, sessionId)
    return {
      ok: false,
      content: assistantText.value,
      sessionId,
      error: 'Reconnect iteration cap reached without a terminal state.',
    }
  }
  if (terminal.status === 'error') {
    return {
      ok: false,
      content: assistantText.value,
      sessionId,
      error: terminal.reason ?? 'Managed Agent session failed.',
    }
  }

  // Best-effort cumulative token usage for the block output.
  const snapshot = await getSession({ apiKey, sessionId, signal })
  return {
    ok: true,
    content: assistantText.value,
    sessionId,
    ...(snapshot?.usage?.inputTokens !== undefined
      ? { inputTokens: snapshot.usage.inputTokens }
      : {}),
    ...(snapshot?.usage?.outputTokens !== undefined
      ? { outputTokens: snapshot.usage.outputTokens }
      : {}),
  }
}

async function handleEvent(args: {
  event: AnthropicSessionEvent
  assistantText: { value: string }
  apiKey: string
  sessionId: string
  signal?: AbortSignal
}): Promise<HandleResult> {
  const { event, assistantText, apiKey, sessionId, signal } = args

  if (event.type === 'agent.message') {
    if (Array.isArray(event.content)) {
      for (const block of event.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          assistantText.value += block.text
        }
      }
    }
    return {}
  }

  if (event.type === 'agent.custom_tool_use') {
    // Without an id we cannot correlate a reply; sending an empty id would
    // strand the session, so log and let it resolve on its own instead.
    if (!event.id) {
      logger.warn('Managed Agent custom_tool_use arrived without an id — skipping reply', {
        sessionId,
      })
      return {}
    }
    logger.warn(
      `Managed Agent invoked a custom tool "${event.name ?? '<unknown>'}" that Sim does not provide — replying with error`
    )
    try {
      await sendSessionEvents({
        apiKey,
        signal,
        sessionId,
        events: [
          {
            type: 'user.custom_tool_result',
            custom_tool_use_id: event.id,
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
      // Leave the event unseen so the next catch-up retries the reply rather
      // than stranding the session on this unanswered tool call.
      return { retry: true }
    }
    return {}
  }

  if (event.type === 'session.status_terminated') {
    return { terminal: { status: 'error', reason: event.error?.message ?? 'session_terminated' } }
  }

  if (event.type === 'session.status_idle') {
    const stop = event.stop_reason?.type
    if (stop === 'end_turn') return { terminal: { status: 'complete' } }
    if (stop === 'retries_exhausted') {
      return { terminal: { status: 'error', reason: 'retries_exhausted' } }
    }
    // `requires_action` (paused for a pending tool call) and any unspecified
    // idle are NOT terminal here. A freshly-created session is `idle` with no
    // stop reason before its first turn, so completing on an unspecified idle
    // would report empty content; instead defer to the authoritative-status
    // gate, which only completes once `sawActivity` is set.
    return {}
  }

  if (event.type === 'session.error') {
    return {
      terminal: {
        status: 'error',
        reason: event.error?.message ?? event.message ?? 'session_error',
      },
    }
  }

  return {}
}
