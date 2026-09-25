/**
 * Keeps a chat's client-executed tools running after the user leaves it
 * mid-turn. Leaving detaches the chat view but not the server run, and that
 * run's browser, terminal, and local filesystem tools execute only in this
 * client: the orchestrator blocks until the client reports each outcome, so
 * without a reader the left chat stalls at its next such call. A relay reads
 * the left turn's stream headlessly and starts those tools until the run ends
 * or the chat's view reads the stream again. Relays live at module scope
 * because switching chats remounts the chat surface that detached them. Each
 * holds one resume connection, and only while its run is live.
 */
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { readSSELines } from '@/lib/core/utils/sse'
import { desktopChatScopeId } from '@/lib/desktop/chat-scope'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import {
  isTerminalStreamStatus,
  type PersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelopeJson,
} from '@/lib/mothership/request/session/contract'
import { executeBrowserToolOnClient } from '@/lib/mothership/tools/client/browser-tool-execution'
import { launchLocalFilesystemTool } from '@/lib/mothership/tools/client/launch-local-filesystem-tool'
import { executeTerminalToolOnClient } from '@/lib/mothership/tools/client/terminal-tool-execution'
import {
  type ClientToolStart,
  resolveClientToolStart,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/client-tool-start'
import {
  buildStreamResumeUrl,
  createStreamSchemaValidationError,
  getStreamEventCursor,
  isAlreadyProcessedStreamCursor,
  isStreamSchemaValidationError,
  parseStreamBatchResponse,
  resolveChatIdFromStreamBatch,
  resolveChatIdFromStreamEvent,
  STREAM_IDLE_TIMEOUT_MS,
} from '@/app/workspace/[workspaceId]/home/hooks/stream-protocol'

const logger = createLogger('DetachedClientTools')

/** A live turn the user left. */
export interface DetachedChatTurn {
  streamId: string
  /** The turn's chat when the view knew it; a new chat's id is read off the stream. */
  chatId?: string
  /** The last cursor the chat view dispatched; the relay resumes after it. */
  afterCursor: string
  traceparent?: string
  workspaceId?: string
  /** The owner key the chat's desktop scope derives from. */
  scopeKey: string
}

interface Relay {
  controller: AbortController
  chatId?: string
}

/** Relays by stream id. An entry is removed when its relay ends. */
const relays = new Map<string, Relay>()

/** The call a tool result frame settles, or undefined for any other event. */
function settledToolCallId(event: PersistedStreamEventEnvelope): string | undefined {
  if (event.type !== MothershipStreamV1EventType.tool || 'previewPhase' in event.payload) {
    return undefined
  }
  return event.payload.phase === MothershipStreamV1ToolPhase.result
    ? event.payload.toolCallId
    : undefined
}

/**
 * Starts the client tools a detached turn hands this client. Workflow runs are
 * left alone: running one drives the workflow editor, and the server runs a
 * workflow call itself when no client picks it up.
 */
function startDetachedClientTool(
  turn: DetachedChatTurn,
  chatId: string,
  start: ClientToolStart
): void {
  const { toolCallId, toolName, args, eventTs } = start
  const scopeId = desktopChatScopeId(turn.scopeKey, chatId)
  switch (start.kind) {
    case 'workflow':
      return
    case 'localFilesystem':
      launchLocalFilesystemTool(toolCallId, toolName, args, {
        workspaceId: turn.workspaceId,
        chatId,
      })
      return
    case 'browser':
      executeBrowserToolOnClient(toolCallId, start.toolName, args, scopeId, eventTs)
      return
    case 'terminal':
      executeTerminalToolOnClient(toolCallId, args, scopeId, eventTs)
      return
  }
}

/**
 * Relays until the run ends or the relay is aborted. Like the chat view's own
 * reconnect, every connection first reads the events past the cursor as one
 * batch, so calls that already have a result are settled before any call frame
 * replays, then tails live. That makes any cursor a safe starting point.
 */
async function relayClientTools(turn: DetachedChatTurn, relay: Relay): Promise<void> {
  const { streamId } = turn
  const { signal } = relay.controller
  const headers = turn.traceparent ? { traceparent: turn.traceparent } : undefined
  /** Calls this relay started or saw settle; ids alone decide what is pending. */
  const handledToolCallIds = new Set<string>()
  let cursor = turn.afterCursor
  let failedAttempts = 0

  const applyEvent = (event: PersistedStreamEventEnvelope): void => {
    const eventCursor = getStreamEventCursor(event)
    if (isAlreadyProcessedStreamCursor(eventCursor, cursor)) return
    cursor = eventCursor
    relay.chatId ??= resolveChatIdFromStreamEvent(event)
    if (event.type !== MothershipStreamV1EventType.tool) return
    const settledId = settledToolCallId(event)
    if (settledId) {
      handledToolCallIds.add(settledId)
      return
    }
    const start = resolveClientToolStart(event, (id) => !handledToolCallIds.has(id))
    if (!start) return
    handledToolCallIds.add(start.toolCallId)
    if (!relay.chatId) {
      logger.error('Detached client tool arrived before its chat id', {
        streamId,
        toolCallId: start.toolCallId,
      })
      return
    }
    startDetachedClientTool(turn, relay.chatId, start)
  }

  /** Reads the events past the cursor at once; resolves true once the run is over. */
  const readBatch = async (): Promise<boolean> => {
    // boundary-raw-fetch: stream-resume batch endpoint needs per-request traceparent propagation the contract layer does not model
    const response = await fetch(buildStreamResumeUrl(streamId, cursor, { batch: true }), {
      signal,
      headers,
    })
    if (response.status === 404) return true
    if (!response.ok) throw new Error(`Stream batch responded with status ${response.status}`)
    const batch = parseStreamBatchResponse(await response.json())
    relay.chatId ??= resolveChatIdFromStreamBatch(batch)
    for (const { event } of batch.events) {
      const settledId = settledToolCallId(event)
      if (settledId) handledToolCallIds.add(settledId)
    }
    for (const { event } of batch.events) applyEvent(event)
    return isTerminalStreamStatus(batch.status)
  }

  /** Tails one live connection; resolves true once the run is over. */
  const readTail = async (): Promise<boolean> => {
    // boundary-raw-fetch: live SSE tail endpoint streams events consumed via readSSELines
    const response = await fetch(buildStreamResumeUrl(streamId, cursor), { signal, headers })
    if (response.status === 404) return true
    if (!response.ok || !response.body) {
      throw new Error(`Stream tail responded with status ${response.status}`)
    }
    let complete = false
    await readSSELines(response.body, {
      signal,
      idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      onData: (raw) => {
        const parsed = parsePersistedStreamEventEnvelopeJson(raw)
        if (!parsed.ok) throw createStreamSchemaValidationError(parsed, 'Detached SSE event.')
        applyEvent(parsed.event)
        if (parsed.event.type === MothershipStreamV1EventType.complete) {
          complete = true
          return true
        }
      },
    })
    return complete
  }

  while (!signal.aborted) {
    const cursorBeforeAttempt = cursor
    try {
      if ((await readBatch()) || (await readTail())) return
    } catch (error) {
      if (signal.aborted) return
      if (isStreamSchemaValidationError(error)) {
        logger.error('Stopped relaying detached client tools on an invalid stream event', {
          streamId,
          error: error.message,
        })
        return
      }
      logger.warn('Detached stream read failed', { streamId, error: getErrorMessage(error) })
    }
    if (cursor !== cursorBeforeAttempt) {
      failedAttempts = 0
      continue
    }
    failedAttempts++
    await interruptibleSleep(backoffWithJitter(failedAttempts, null), signal)
  }
}

/** Relays a left turn's client tools until its run ends or its chat's view reads it again. */
export function detachClientTools(turn: DetachedChatTurn): void {
  relays.get(turn.streamId)?.controller.abort('superseded_detached_relay')
  const relay: Relay = { controller: new AbortController(), chatId: turn.chatId }
  relays.set(turn.streamId, relay)
  void relayClientTools(turn, relay).finally(() => {
    if (relays.get(turn.streamId) === relay) relays.delete(turn.streamId)
  })
}

/**
 * Stops relaying a chat whose view reads its stream again. Tools the relay
 * already started keep running and report their outcome.
 */
export function reattachClientTools(chatId: string): void {
  for (const [streamId, relay] of relays) {
    if (relay.chatId !== chatId) continue
    relay.controller.abort('chat_reattached')
    relays.delete(streamId)
  }
}
