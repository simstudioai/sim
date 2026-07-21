import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { readSSEEvents } from '@/lib/core/utils/sse'
import {
  type AnthropicSessionEvent,
  type CreateSessionInput,
  createSession,
  getSession,
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
    if (event.id) seenIds.add(event.id)
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
    if (outcome) {
      terminal = outcome
      return true
    }
    return false
  }

  try {
    for (let iteration = 0; iteration < MAX_RECONNECT_ITERATIONS && !terminal; iteration++) {
      if (signal?.aborted) break
      if (Date.now() - startedAt > MAX_SESSION_MS) {
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
          if (event.id && seenIds.has(event.id)) return undefined
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
        progressed = true
        if (await process(event)) break
      }
      if (terminal || signal?.aborted) break

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
}): Promise<Terminal | null> {
  const { event, assistantText, apiKey, sessionId, signal } = args

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
    // Without an id we cannot correlate a reply; sending an empty id would
    // strand the session, so log and let it resolve on its own instead.
    if (!event.id) {
      logger.warn('Managed Agent custom_tool_use arrived without an id — skipping reply', {
        sessionId,
      })
      return null
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
    }
    return null
  }

  if (event.type === 'session.status_terminated') {
    return { status: 'error', reason: event.error?.message ?? 'session_terminated' }
  }

  if (event.type === 'session.status_idle') {
    const stop = event.stop_reason?.type
    // `requires_action` is not terminal — the session is paused for a pending
    // tool call and will emit a terminal event once it resolves.
    if (stop === 'requires_action') return null
    if (stop === 'retries_exhausted') return { status: 'error', reason: 'retries_exhausted' }
    // `end_turn` (or an unspecified idle) means the agent finished its turn.
    return { status: 'complete' }
  }

  if (event.type === 'session.error') {
    return { status: 'error', reason: event.error?.message ?? event.message ?? 'session_error' }
  }

  return null
}
