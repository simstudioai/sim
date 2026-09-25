/**
 * Keeps a chat's client-executed tools running after the user leaves it
 * mid-turn. Leaving detaches the chat view but not the server run, and that
 * run's browser, terminal, and local filesystem tools execute only in this
 * client: the orchestrator blocks until the client reports each outcome, so
 * without a reader the left chat stalls at its next such call. A relay tails
 * the left chat's stream headlessly and starts those tools until the run
 * completes or the chat is reopened. Relays live at module scope because
 * switching chats remounts the chat surface that detached them. Each holds one
 * resume connection, so a relay exists only while its left run is live.
 */
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { readSSELines } from '@/lib/core/utils/sse'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolPhase,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { parsePersistedStreamEventEnvelopeJson } from '@/lib/mothership/request/session/contract'
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
  STREAM_IDLE_TIMEOUT_MS,
} from '@/app/workspace/[workspaceId]/home/hooks/stream-protocol'

const logger = createLogger('DetachedClientTools')

/** Consecutive tail attempts that make no progress before a relay gives up. */
const MAX_STALLED_TAIL_ATTEMPTS = 5

/** A live turn the user left, and where its client tools run. */
export interface DetachedChatTurn {
  chatId: string
  streamId: string
  /** The last cursor the chat view dispatched; the relay resumes after it. */
  afterCursor: string
  traceparent?: string
  workspaceId?: string
  /** The chat's desktop scope, which owns its browser and terminal tabs. */
  scopeId: string
}

/** Relays by chat id. An entry is removed when its relay ends. */
const relays = new Map<string, AbortController>()

/**
 * Starts the client tools a detached turn hands this client. Workflow runs are
 * left alone: running one drives the workflow editor, and the server runs a
 * workflow call itself when no client picks it up.
 */
function startDetachedClientTool(turn: DetachedChatTurn, start: ClientToolStart): void {
  const { toolCallId, toolName, args, eventTs } = start
  switch (start.kind) {
    case 'workflow':
      return
    case 'localFilesystem':
      launchLocalFilesystemTool(toolCallId, toolName, args, {
        workspaceId: turn.workspaceId,
        chatId: turn.chatId,
      })
      return
    case 'browser':
      executeBrowserToolOnClient(toolCallId, start.toolName, args, turn.scopeId, eventTs)
      return
    case 'terminal':
      executeTerminalToolOnClient(toolCallId, args, turn.scopeId, eventTs)
      return
  }
}

async function relayClientTools(turn: DetachedChatTurn, signal: AbortSignal): Promise<void> {
  const { streamId, traceparent } = turn
  /** Calls this relay started or saw settle; ids alone decide what is pending. */
  const handledToolCallIds = new Set<string>()
  let cursor = turn.afterCursor
  let stalledAttempts = 0

  /** Reads one tail connection; resolves true once the run is over. */
  const readTail = async (): Promise<boolean> => {
    // boundary-raw-fetch: live SSE tail endpoint streams events consumed via readSSELines
    const response = await fetch(buildStreamResumeUrl(streamId, cursor), {
      signal,
      ...(traceparent ? { headers: { traceparent } } : {}),
    })
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
        const event = parsed.event
        const eventCursor = getStreamEventCursor(event)
        if (isAlreadyProcessedStreamCursor(eventCursor, cursor)) return
        cursor = eventCursor

        if (event.type === MothershipStreamV1EventType.tool) {
          const start = resolveClientToolStart(event, (id) => !handledToolCallIds.has(id))
          if (start) {
            handledToolCallIds.add(start.toolCallId)
            startDetachedClientTool(turn, start)
          } else if (
            !('previewPhase' in event.payload) &&
            event.payload.phase === MothershipStreamV1ToolPhase.result
          ) {
            handledToolCallIds.add(event.payload.toolCallId)
          }
        }
        if (event.type === MothershipStreamV1EventType.complete) {
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
      if (await readTail()) return
    } catch (error) {
      if (signal.aborted) return
      if (isStreamSchemaValidationError(error)) {
        logger.error('Stopped relaying detached client tools on an invalid stream event', {
          streamId,
          error: error.message,
        })
        return
      }
      logger.warn('Detached stream tail failed', { streamId, error: getErrorMessage(error) })
    }

    if (cursor !== cursorBeforeAttempt) {
      stalledAttempts = 0
      continue
    }
    stalledAttempts++
    if (stalledAttempts >= MAX_STALLED_TAIL_ATTEMPTS) {
      logger.warn('Stopped relaying detached client tools after repeated stalls', {
        streamId,
        cursor,
      })
      return
    }
    await interruptibleSleep(backoffWithJitter(stalledAttempts, null), signal)
  }
}

/**
 * Relays a left turn's client tools until its run completes or the chat is
 * reopened. Replaces any relay the chat already has.
 */
export function detachClientTools(turn: DetachedChatTurn): void {
  relays.get(turn.chatId)?.abort('superseded_detached_relay')
  const controller = new AbortController()
  relays.set(turn.chatId, controller)
  void relayClientTools(turn, controller.signal).finally(() => {
    if (relays.get(turn.chatId) === controller) relays.delete(turn.chatId)
  })
}

/**
 * Stops relaying a chat the user reopened; its chat view takes the turn back.
 * Tools the relay already started keep running and report their outcome.
 */
export function reattachClientTools(chatId: string): void {
  relays.get(chatId)?.abort('chat_reattached')
  relays.delete(chatId)
}
