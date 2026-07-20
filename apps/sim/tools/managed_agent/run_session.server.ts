import 'server-only'

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
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
const MAX_RECONNECT_ITERATIONS = 8

const impl: ManagedAgentServerImpl = async (
  params: ManagedAgentRunSessionParams
): Promise<ToolResponse> => {
  const startedAt = new Date()
  const context = params._context
  const workspaceId = context?.workspaceId
  if (!workspaceId) {
    return {
      success: false,
      output: {},
      error: 'Missing workspaceId in tool context — is this workflow tied to a workspace?',
    }
  }

  const apiKey = await getDecryptedApiKey({ id: params.connection, workspaceId })
  if (!apiKey) {
    return {
      success: false,
      output: {},
      error: 'Managed Agent connection not found. Reconnect the Claude workspace and retry.',
    }
  }

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
    await sendUserMessage({ apiKey, sessionId, text: userMessage })
  } catch (error) {
    return {
      success: false,
      output: { sessionId },
      error: getErrorMessage(error, 'Failed to send user message'),
    }
  }

  const assistantText = { value: '' }
  const seenIds = new Set<string>()
  const eventState: EventState = {
    lastCustomToolResponseAt: 0,
    lastRequiresActionAt: 0,
  }
  let lastEventId: string | null = null
  let terminal: { status: 'complete' | 'error'; reason?: string } | null = null

  try {
    for (
      let iteration = 0;
      iteration < MAX_RECONNECT_ITERATIONS && !terminal;
      iteration++
    ) {
      const streamResp = await openSessionStream({ apiKey, sessionId })
      await readSSEEvents<AnthropicSessionEvent>(streamResp, {
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

      const missed = await listEventsAfter({ apiKey, sessionId, afterId: lastEventId })
      if (missed.length === 0) {
        // Session went idle with no new events to catch up on. Three cases:
        //   1. `requires_action` + we replied to the `custom_tool_use` →
        //      the agent is chewing on our reply; reconnect once more.
        //      Reset the marker so we cap this at one retry per cycle.
        //   2. `requires_action` + we did NOT reply (typically a stuck
        //      server-side / MCP tool the agent couldn't complete) →
        //      surface a clear terminal error instead of silently
        //      succeeding with empty text.
        //   3. No pending action → clean completion (usually already
        //      hit via `end_turn` earlier; this is the fallback path).
        if (eventState.lastRequiresActionAt > 0) {
          if (eventState.lastCustomToolResponseAt >= eventState.lastRequiresActionAt) {
            eventState.lastRequiresActionAt = 0
            continue
          }
          terminal = {
            status: 'error',
            reason:
              'Session paused (requires_action) — the agent invoked a tool that could not complete. Check MCP server / vault configuration on Claude Platform.',
          }
          break
        }
        terminal = { status: 'complete' }
        break
      }
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
 * Tracks how far along the session is in resolving a `requires_action`
 * pause. If we replied to the pending `custom_tool_use` before the idle
 * event fires, the session will unpause on its own — we must NOT treat
 * the idle-with-requires-action as terminal in that case.
 */
interface EventState {
  lastCustomToolResponseAt: number
  lastRequiresActionAt: number
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
      // Session paused for a pending action. If we've already replied to a
      // `custom_tool_use` since the last pause, the session will resume on
      // its own — return null so the reconnect loop reopens the stream and
      // picks up the follow-on events.
      eventState.lastRequiresActionAt = Date.now()
      if (eventState.lastCustomToolResponseAt >= eventState.lastRequiresActionAt) {
        return null
      }
      // No reply was sent — likely a server-side tool (MCP) call the agent
      // itself will drive, or a genuinely stuck session. Return null too
      // so the reconnect loop reopens the stream; if the session is truly
      // stuck, `listEventsAfter` returning empty on the next iteration will
      // finalize the run as complete with whatever text we have.
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
