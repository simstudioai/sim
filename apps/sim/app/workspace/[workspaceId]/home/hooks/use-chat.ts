import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { isBrowserToolName } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import {
  addMothershipChatResourceContract,
  removeMothershipChatResourceContract,
  reorderMothershipChatResourcesContract,
} from '@/lib/api/contracts/mothership-chats'
import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { initBrowserAgentTransport, isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'
import { toDisplayMessage } from '@/lib/copilot/chat/display-message'
import { getLiveAssistantMessageId } from '@/lib/copilot/chat/effective-transcript'
import type {
  PersistedFileAttachment,
  PersistedMessage,
} from '@/lib/copilot/chat/persisted-message'
import { normalizeMessage, withBlockTiming } from '@/lib/copilot/chat/persisted-message'
import {
  type RevealedSimKeysByMessage,
  restoreRevealedSimKeysForMessage,
} from '@/lib/copilot/chat/sim-key-redaction'
import { MOTHERSHIP_CHAT_API_PATH, STREAM_STORAGE_KEY } from '@/lib/copilot/constants'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1TextChannel,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  type ParseStreamEventEnvelopeFailure,
  parsePersistedStreamEventEnvelope,
  parsePersistedStreamEventEnvelopeJson,
} from '@/lib/copilot/request/session/contract'
import {
  type FilePreviewSession,
  isFilePreviewSession,
} from '@/lib/copilot/request/session/file-preview-session-contract'
import type { StreamBatchEvent } from '@/lib/copilot/request/session/types'
import { BROWSER_SESSION_RESOURCE_ID, isEphemeralResource } from '@/lib/copilot/resources/types'
import { executeBrowserToolOnClient } from '@/lib/copilot/tools/client/browser-tool-execution'
import { executeLocalFilesystemTool } from '@/lib/copilot/tools/client/local-filesystem'
import {
  bindRunToolToExecution,
  cancelRunToolExecution,
  executeRunToolOnClient,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/tools/client/run-tool-execution'
import { setCurrentChatTraceparent } from '@/lib/copilot/tools/client/trace-context'
import { isLocalFilesystemToolName } from '@/lib/copilot/tools/local-filesystem'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'
import { readSSELines } from '@/lib/core/utils/sse'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { useFilePreviewController } from '@/app/workspace/[workspaceId]/home/hooks/preview'
import {
  applyTurnTerminal,
  createStreamLoopContext,
  dispatchStreamEvent,
  finalizeResidualToolCalls,
} from '@/app/workspace/[workspaceId]/home/hooks/stream'
import {
  fetchMothershipChatHistory,
  type MothershipChatHistory,
  mothershipChatKeys,
  useMothershipChatHistory,
} from '@/hooks/queries/mothership-chats'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { invalidateWorkflowSelectors } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflowById, getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { workflowKeys } from '@/hooks/queries/workflows'
import { useExecutionStream } from '@/hooks/use-execution-stream'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'
import type {
  QueuedMothershipMessage,
  QueuedSendHandoffSeed,
} from '@/stores/mothership-queue/types'
import type { ChatContext } from '@/stores/panel'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import type {
  ChatMessage,
  ContentBlock,
  FileAttachmentForApi,
  GenericResourceData,
  MothershipResource,
  MothershipResourceType,
  QueuedMessage,
  ToolCallInfo,
} from '../types'

export interface UseChatReturn {
  messages: ChatMessage[]
  isSending: boolean
  isReconnecting: boolean
  error: string | null
  resolvedChatId: string | undefined
  sendMessage: (
    message: string,
    fileAttachments?: FileAttachmentForApi[],
    contexts?: ChatContext[]
  ) => Promise<void>
  stopGeneration: () => Promise<void>
  resources: MothershipResource[]
  activeResourceId: string | null
  setActiveResourceId: (id: string | null) => void
  addResource: (resource: MothershipResource) => boolean
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  reorderResources: (resources: MothershipResource[]) => void
  messageQueue: QueuedMessage[]
  removeFromQueue: (id: string) => void
  sendNow: (id: string) => Promise<void>
  editQueuedMessage: (id: string) => QueuedMessage | undefined
  cancelQueueEdit: () => void
  editingQueuedId: string | null
  dispatchingHeadId: string | null
  previewSession: FilePreviewSession | null
  genericResourceData: GenericResourceData | null
  getCurrentRequestId: () => string | undefined
}

const RECONNECT_TAIL_ERROR =
  'Live reconnect failed before the stream finished. The latest response may be incomplete.'
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000
const STREAM_BATCH_FETCH_TIMEOUT_MS = 10_000
const STREAM_CHAT_ID_RESOLVE_TIMEOUT_MS = 10_000
const CHAT_HISTORY_RECOVERY_TIMEOUT_MS = 10_000
const STOP_REQUEST_TIMEOUT_MS = 15_000
const QUEUED_SEND_HANDOFF_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff`
const QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY = `${STREAM_STORAGE_KEY}:queued-send-handoff-claim`
const QUEUED_SEND_HANDOFF_TTL_MS = 5 * 60 * 1000
const QUEUED_SEND_HANDOFF_CLAIM_TTL_MS = 30_000
const QUEUED_SEND_HANDOFF_RETRY_BASE_MS = 1000
const QUEUED_SEND_HANDOFF_RETRY_MAX_MS = 30_000

// Stable empty array — sharing one reference keeps the selector from
// re-rendering on unrelated store writes.
const EMPTY_MESSAGE_QUEUE: QueuedMothershipMessage[] = []

const logger = createLogger('useChat')

type QueueDispatchAction = { type: 'send_head'; epoch: number }

type QueueDispatchActionInput = { type: 'send_head' }

type ActiveTurn = {
  userMessageId: string
  assistantMessageId: string
  optimisticUserMessage: ChatMessage
  optimisticAssistantMessage: ChatMessage
}

interface QueuedSendHandoffState {
  id: string
  chatId?: string
  workspaceId: string
  supersededStreamId: string | null
  userMessageId: string
  message: string
  fileAttachments?: FileAttachmentForApi[]
  contexts?: ChatContext[]
  requestedAt: number
  resolveAttempts?: number
}

interface QueuedSendHandoffClaim {
  id: string
  ownerId: string
  claimedAt: number
}

interface ActiveQueuedSendHandoffRecovery {
  id: string
  ownerId: string
}

function createTimeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  if (typeof AbortController === 'undefined') return undefined

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Operation timed out after ${ms}ms`))
  }, ms)
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true })
  return controller.signal
}

function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (activeSignals.length === 0) return undefined
  if (activeSignals.length === 1) return activeSignals[0]
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals)
  }
  if (typeof AbortController === 'undefined') return activeSignals[0]

  const controller = new AbortController()
  const abortFromSource = (source: AbortSignal) => {
    cleanup()
    controller.abort(source.reason)
  }
  const listeners = activeSignals.map((signal) => {
    const listener = () => abortFromSource(signal)
    signal.addEventListener('abort', listener, { once: true })
    return { signal, listener }
  })
  function cleanup() {
    for (const { signal, listener } of listeners) {
      signal.removeEventListener('abort', listener)
    }
  }
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFromSource(signal)
      break
    }
  }
  controller.signal.addEventListener('abort', cleanup, { once: true })
  return controller.signal
}

function createAbortError(signal: AbortSignal): Error {
  const error = new Error(signal.reason ? String(signal.reason) : 'Operation aborted')
  error.name = 'AbortError'
  return error
}

async function sleepWithAbort(ms: number, signal?: AbortSignal) {
  if (!signal) {
    await sleep(ms)
    return
  }
  if (signal.aborted) throw createAbortError(signal)

  let cleanup: (() => void) | undefined
  await Promise.race([
    sleep(ms),
    new Promise<never>((_, reject) => {
      const onAbort = () => reject(createAbortError(signal))
      cleanup = () => signal.removeEventListener('abort', onAbort)
      signal.addEventListener('abort', onAbort, { once: true })
    }),
  ]).finally(() => cleanup?.())
}

function isFileAttachmentForApi(value: unknown): value is FileAttachmentForApi {
  if (!isRecordLike(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.key === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.media_type === 'string' &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    (value.path === undefined || typeof value.path === 'string')
  )
}

function isChatContext(value: unknown): value is ChatContext {
  if (!isRecordLike(value) || typeof value.kind !== 'string' || typeof value.label !== 'string') {
    return false
  }

  switch (value.kind) {
    case 'past_chat':
      return typeof value.chatId === 'string'
    case 'workflow':
    case 'current_workflow':
      return typeof value.workflowId === 'string'
    case 'blocks':
      return Array.isArray(value.blockIds) && value.blockIds.every((id) => typeof id === 'string')
    case 'logs':
      return value.executionId === undefined || typeof value.executionId === 'string'
    case 'workflow_block':
      return typeof value.workflowId === 'string' && typeof value.blockId === 'string'
    case 'knowledge':
      return value.knowledgeId === undefined || typeof value.knowledgeId === 'string'
    case 'table':
      return typeof value.tableId === 'string'
    case 'file':
      return typeof value.fileId === 'string'
    case 'folder':
      return typeof value.folderId === 'string'
    case 'filefolder':
      return typeof value.fileFolderId === 'string'
    case 'scheduledtask':
      return typeof value.scheduleId === 'string'
    case 'docs':
      return true
    case 'slash_command':
      return typeof value.command === 'string'
    case 'integration':
      return typeof value.blockType === 'string'
    case 'skill':
      return typeof value.skillId === 'string'
    default:
      return false
  }
}

function readQueuedSendHandoffState(): QueuedSendHandoffState | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<QueuedSendHandoffState>
    const chatId = typeof parsed.chatId === 'string' ? parsed.chatId : undefined
    const supersededStreamId =
      typeof parsed.supersededStreamId === 'string' ? parsed.supersededStreamId : null
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.userMessageId !== 'string' ||
      typeof parsed.message !== 'string' ||
      typeof parsed.requestedAt !== 'number' ||
      (!chatId && !supersededStreamId)
    ) {
      return null
    }
    if (Date.now() - parsed.requestedAt > QUEUED_SEND_HANDOFF_TTL_MS) {
      window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
      if (readQueuedSendHandoffClaim() === parsed.id) {
        window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
      }
      return null
    }

    return {
      id: parsed.id,
      ...(chatId ? { chatId } : {}),
      workspaceId: parsed.workspaceId,
      supersededStreamId,
      userMessageId: parsed.userMessageId,
      message: parsed.message,
      ...(Array.isArray(parsed.fileAttachments)
        ? { fileAttachments: parsed.fileAttachments.filter(isFileAttachmentForApi) }
        : {}),
      ...(Array.isArray(parsed.contexts)
        ? { contexts: parsed.contexts.filter(isChatContext) }
        : {}),
      requestedAt: parsed.requestedAt,
      ...(typeof parsed.resolveAttempts === 'number' &&
      Number.isFinite(parsed.resolveAttempts) &&
      parsed.resolveAttempts > 0
        ? { resolveAttempts: parsed.resolveAttempts }
        : {}),
    }
  } catch {
    return null
  }
}

function writeQueuedSendHandoffState(state: QueuedSendHandoffState) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(QUEUED_SEND_HANDOFF_STORAGE_KEY, JSON.stringify(state))
}

function clearQueuedSendHandoffState(expectedId?: string) {
  if (typeof window === 'undefined') return
  if (expectedId) {
    const current = readQueuedSendHandoffState()
    if (current && current.id !== expectedId) {
      return
    }
  }
  window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_STORAGE_KEY)
}

function readQueuedSendHandoffClaimState(): QueuedSendHandoffClaim | null {
  if (typeof window === 'undefined') return null
  const raw = window.sessionStorage.getItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<QueuedSendHandoffClaim>
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed.ownerId !== 'string' ||
      typeof parsed.claimedAt !== 'number'
    ) {
      window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
      return null
    }
    if (Date.now() - parsed.claimedAt > QUEUED_SEND_HANDOFF_CLAIM_TTL_MS) {
      window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
      return null
    }
    return { id: parsed.id, ownerId: parsed.ownerId, claimedAt: parsed.claimedAt }
  } catch {
    window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
    return null
  }
}

function readQueuedSendHandoffClaim(): string | null {
  return readQueuedSendHandoffClaimState()?.id ?? null
}

function hasQueuedSendHandoffClaimOwner(id: string, ownerId: string): boolean {
  const claim = readQueuedSendHandoffClaimState()
  return claim?.id === id && claim.ownerId === ownerId
}

function queuedSendHandoffClaimRetryDelay(id: string): number | null {
  const claim = readQueuedSendHandoffClaimState()
  if (!claim || claim.id !== id) return null
  const elapsed = Date.now() - claim.claimedAt
  return Math.max(0, QUEUED_SEND_HANDOFF_CLAIM_TTL_MS - elapsed + 1)
}

function queuedSendHandoffResolveRetryDelay(resolveAttempts: number): number {
  return Math.min(
    QUEUED_SEND_HANDOFF_RETRY_MAX_MS,
    QUEUED_SEND_HANDOFF_RETRY_BASE_MS * 2 ** Math.max(0, resolveAttempts - 1)
  )
}

function writeQueuedSendHandoffClaim(id: string): string {
  const ownerId = generateId()
  if (typeof window === 'undefined') return ownerId
  window.sessionStorage.setItem(
    QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY,
    JSON.stringify({ id, ownerId, claimedAt: Date.now() } satisfies QueuedSendHandoffClaim)
  )
  return ownerId
}

function clearQueuedSendHandoffClaim(expectedId?: string, expectedOwnerId?: string) {
  if (typeof window === 'undefined') return
  if (expectedId) {
    const current = readQueuedSendHandoffClaimState()
    if (
      current &&
      (current.id !== expectedId || (expectedOwnerId && current.ownerId !== expectedOwnerId))
    ) {
      return
    }
  }
  window.sessionStorage.removeItem(QUEUED_SEND_HANDOFF_CLAIM_STORAGE_KEY)
}

type StreamBatchResponse = {
  success: boolean
  events: StreamBatchEvent[]
  previewSessions?: FilePreviewSession[]
  status: string
  chatId?: string
}

const STREAM_SCHEMA_ENFORCEMENT_PREFIX = 'Client stream schema enforcement failed.'

class StreamSchemaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamSchemaValidationError'
  }
}

function createStreamSchemaValidationError(
  failure: ParseStreamEventEnvelopeFailure,
  context?: string
): StreamSchemaValidationError {
  const details = failure.errors?.filter(Boolean).join('; ')
  return new StreamSchemaValidationError(
    [STREAM_SCHEMA_ENFORCEMENT_PREFIX, context, failure.message, details].filter(Boolean).join(' ')
  )
}

function createBatchSchemaValidationError(message: string): StreamSchemaValidationError {
  return new StreamSchemaValidationError([STREAM_SCHEMA_ENFORCEMENT_PREFIX, message].join(' '))
}

function isStreamSchemaValidationError(error: unknown): error is StreamSchemaValidationError {
  return error instanceof StreamSchemaValidationError
}

function parseStreamBatchResponse(value: unknown): StreamBatchResponse {
  if (!isRecordLike(value)) {
    throw new Error('Invalid stream batch response')
  }

  const rawEvents = Array.isArray(value.events) ? value.events : []
  const events: StreamBatchEvent[] = []
  for (const [index, entry] of rawEvents.entries()) {
    if (!isRecordLike(entry)) {
      throw createBatchSchemaValidationError(`Reconnect batch event ${index + 1} is not an object.`)
    }
    if (
      typeof entry.eventId !== 'number' ||
      !Number.isFinite(entry.eventId) ||
      typeof entry.streamId !== 'string'
    ) {
      throw createBatchSchemaValidationError(
        `Reconnect batch event ${index + 1} is missing required metadata.`
      )
    }

    const parsedEvent = parsePersistedStreamEventEnvelope(entry.event)
    if (!parsedEvent.ok) {
      throw createStreamSchemaValidationError(parsedEvent, `Reconnect batch event ${index + 1}.`)
    }

    events.push({
      eventId: entry.eventId,
      streamId: entry.streamId,
      event: parsedEvent.event,
    })
  }

  const rawPreviewSessions = Array.isArray(value.previewSessions)
    ? value.previewSessions
    : undefined
  const previewSessions =
    rawPreviewSessions?.map((session, index) => {
      if (!isFilePreviewSession(session)) {
        throw createBatchSchemaValidationError(
          `Reconnect preview session ${index + 1} failed validation.`
        )
      }
      return session
    }) ?? undefined

  return {
    success: value.success === true,
    events,
    ...(previewSessions ? { previewSessions } : {}),
    status: typeof value.status === 'string' ? value.status : 'unknown',
    ...(typeof value.chatId === 'string' && value.chatId ? { chatId: value.chatId } : {}),
  }
}

function resolveChatIdFromStreamBatch(batch: StreamBatchResponse): string | undefined {
  if (batch.chatId) return batch.chatId

  for (const { event } of batch.events) {
    const streamChatId = typeof event.stream?.chatId === 'string' ? event.stream.chatId : undefined
    if (streamChatId) return streamChatId
    if (
      event.type === MothershipStreamV1EventType.session &&
      event.payload.kind === MothershipStreamV1SessionKind.chat
    ) {
      return event.payload.chatId
    }
  }

  return undefined
}

function toRawPersistedContentBlock(block: ContentBlock): Record<string, unknown> | null {
  const persisted = toRawPersistedContentBlockBody(block)
  if (!persisted) return null
  if (block.parentToolCallId) persisted.parentToolCallId = block.parentToolCallId
  // Carry deterministic span identity onto the live streaming snapshot so the
  // rendered live message nests subagents via the span tree. Without this the
  // live blocks lose spanId and parseBlocks falls back to legacy flat grouping,
  // rendering nested subagents (e.g. deploy) at the top level mid-stream until
  // the persisted message (which keeps spanId) replaces it.
  if (block.spanId) persisted.spanId = block.spanId
  if (block.parentSpanId) persisted.parentSpanId = block.parentSpanId
  return withBlockTiming(persisted, block)
}

function toRawPersistedContentBlockBody(block: ContentBlock): Record<string, unknown> | null {
  switch (block.type) {
    case 'text':
      return {
        type: MothershipStreamV1EventType.text,
        ...(block.subagent ? { lane: 'subagent' } : {}),
        channel: MothershipStreamV1TextChannel.assistant,
        content: block.content ?? '',
      }
    case 'thinking':
      return {
        type: MothershipStreamV1EventType.text,
        channel: MothershipStreamV1TextChannel.thinking,
        content: block.content ?? '',
      }
    case 'subagent_thinking':
      return {
        type: MothershipStreamV1EventType.text,
        lane: 'subagent',
        channel: MothershipStreamV1TextChannel.thinking,
        content: block.content ?? '',
      }
    case 'subagent_text':
      return {
        type: MothershipStreamV1EventType.text,
        lane: 'subagent',
        channel: MothershipStreamV1TextChannel.assistant,
        content: block.content ?? '',
      }
    case 'tool_call':
      if (!block.toolCall) {
        return null
      }
      return {
        type: MothershipStreamV1EventType.tool,
        phase: MothershipStreamV1ToolPhase.call,
        toolCall: {
          id: block.toolCall.id,
          name: block.toolCall.name,
          state: block.toolCall.status,
          ...(block.toolCall.params ? { params: block.toolCall.params } : {}),
          ...(block.toolCall.result ? { result: block.toolCall.result } : {}),
          ...(block.toolCall.calledBy ? { calledBy: block.toolCall.calledBy } : {}),
          ...(block.toolCall.displayTitle
            ? {
                display: {
                  title: block.toolCall.displayTitle,
                },
              }
            : {}),
        },
      }
    case 'subagent':
      return {
        type: MothershipStreamV1EventType.span,
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        lifecycle: MothershipStreamV1SpanLifecycleEvent.start,
        content: block.content ?? '',
      }
    case 'subagent_end':
      return {
        type: MothershipStreamV1EventType.span,
        kind: MothershipStreamV1SpanPayloadKind.subagent,
        lifecycle: MothershipStreamV1SpanLifecycleEvent.end,
      }
    case 'stopped':
      return {
        type: MothershipStreamV1EventType.complete,
        status: MothershipStreamV1CompletionStatus.cancelled,
      }
    default:
      return null
  }
}

function buildAssistantSnapshotMessage(params: {
  id: string
  content: string
  contentBlocks: ContentBlock[]
  requestId?: string
}): PersistedMessage {
  const rawContentBlocks = params.contentBlocks
    .map(toRawPersistedContentBlock)
    .filter((block): block is Record<string, unknown> => block !== null)

  return normalizeMessage({
    id: params.id,
    role: 'assistant',
    content: params.content,
    timestamp: new Date().toISOString(),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    ...(rawContentBlocks.length > 0 ? { contentBlocks: rawContentBlocks } : {}),
  })
}

function markMessageStopped(message: PersistedMessage): PersistedMessage {
  const hasExecutingTool = message.contentBlocks?.some(
    (block) => block.toolCall?.state === 'executing'
  )
  const hasOpenBlock = message.contentBlocks?.some((block) => block.endedAt === undefined)
  if (!hasExecutingTool && !hasOpenBlock) {
    return message
  }

  const stopTs = Date.now()
  const nextBlocks = (message.contentBlocks ?? []).map((block) => {
    const stamped = block.endedAt === undefined ? { ...block, endedAt: stopTs } : block
    if (stamped.toolCall?.state !== 'executing') {
      return stamped
    }
    return {
      ...stamped,
      toolCall: {
        ...stamped.toolCall,
        state: 'cancelled' as const,
        display: {
          ...(stamped.toolCall.display ?? {}),
          title: 'Stopped by user',
        },
      },
    }
  })

  if (
    !nextBlocks.some(
      (block) =>
        block.type === MothershipStreamV1EventType.complete &&
        block.status === MothershipStreamV1CompletionStatus.cancelled
    )
  ) {
    nextBlocks.push({
      type: MothershipStreamV1EventType.complete,
      status: MothershipStreamV1CompletionStatus.cancelled,
    })
  }

  return normalizeMessage({
    ...message,
    contentBlocks: nextBlocks,
  })
}

function buildChatHistoryHydrationKey(chatHistory: MothershipChatHistory): string {
  const resourceKey = chatHistory.resources
    .map((resource) => `${resource.type}:${resource.id}:${resource.title}`)
    .join('|')
  const messageKey = chatHistory.messages.map((message) => message.id).join('|')
  const streamSnapshot = chatHistory.streamSnapshot
  const snapshotKey = streamSnapshot
    ? [
        streamSnapshot.status,
        streamSnapshot.events.length,
        streamSnapshot.events[streamSnapshot.events.length - 1]?.eventId ?? '',
        streamSnapshot.previewSessions
          .map(
            (session) =>
              `${session.id}:${session.previewVersion}:${session.status}:${session.updatedAt}`
          )
          .join('|'),
      ].join('~')
    : 'none'

  return [
    chatHistory.id,
    chatHistory.activeStreamId ?? '',
    messageKey,
    resourceKey,
    snapshotKey,
  ].join('::')
}

const TERMINAL_STREAM_STATUSES = new Set(['complete', 'error', 'cancelled'])

function isTerminalStreamStatus(status: string | null | undefined): boolean {
  return TERMINAL_STREAM_STATUSES.has(status ?? '')
}

function isAlreadyProcessedStreamCursor(
  eventCursor: string | undefined,
  currentCursor: string
): boolean {
  if (!eventCursor) return false

  const eventSequence = Number(eventCursor)
  const currentSequence = Number(currentCursor)
  return (
    Number.isFinite(eventSequence) &&
    Number.isFinite(currentSequence) &&
    eventSequence <= currentSequence
  )
}

function isZeroStreamCursor(cursor: string): boolean {
  const sequence = Number(cursor)
  return Number.isFinite(sequence) && sequence <= 0
}

function isPersistedAssistantMessage(message: PersistedMessage, liveAssistantId: string): boolean {
  return (
    message.role === 'assistant' &&
    message.id !== liveAssistantId &&
    !message.id.startsWith('live-assistant:')
  )
}

function findStreamOwnerIndex(messages: PersistedMessage[], streamId: string): number {
  return messages.findIndex((message) => message.role === 'user' && message.id === streamId)
}

function findAssistantAfterOwner(messages: PersistedMessage[], ownerIndex: number): number {
  for (let index = ownerIndex + 1; index < messages.length; index++) {
    const message = messages[index]
    if (message.role === 'user') return -1
    if (message.role === 'assistant') return index
  }
  return -1
}

function hasTerminalPersistedAssistantForStream(
  messages: PersistedMessage[],
  streamId: string,
  liveAssistantId: string
): boolean {
  const ownerIndex = findStreamOwnerIndex(messages, streamId)
  if (ownerIndex === -1) return false

  const assistantIndex = findAssistantAfterOwner(messages, ownerIndex)
  if (assistantIndex === -1) return false

  return isPersistedAssistantMessage(messages[assistantIndex], liveAssistantId)
}

export function reconcileLiveAssistantTurn(params: {
  messages: PersistedMessage[]
  streamId: string
  liveAssistant: PersistedMessage
  activeStreamId: string | null
}): PersistedMessage[] {
  const { messages, streamId, liveAssistant, activeStreamId } = params
  const ownerIndex = findStreamOwnerIndex(messages, streamId)
  if (ownerIndex === -1) {
    return [...messages.filter((message) => message.id !== liveAssistant.id), liveAssistant]
  }

  const assistantIndex = findAssistantAfterOwner(messages, ownerIndex)
  const existingAssistant = assistantIndex >= 0 ? messages[assistantIndex] : undefined
  if (
    activeStreamId !== streamId &&
    existingAssistant &&
    isPersistedAssistantMessage(existingAssistant, liveAssistant.id)
  ) {
    const withoutStaleLiveAssistant = messages.filter((message) => message.id !== liveAssistant.id)
    return withoutStaleLiveAssistant.length === messages.length
      ? messages
      : withoutStaleLiveAssistant
  }

  const withoutDuplicateLiveAssistant = messages.filter(
    (message, index) => index === assistantIndex || message.id !== liveAssistant.id
  )
  const adjustedOwnerIndex = withoutDuplicateLiveAssistant.findIndex(
    (message) => message.role === 'user' && message.id === streamId
  )
  const adjustedAssistantIndex =
    adjustedOwnerIndex >= 0
      ? findAssistantAfterOwner(withoutDuplicateLiveAssistant, adjustedOwnerIndex)
      : -1

  if (adjustedAssistantIndex >= 0) {
    return withoutDuplicateLiveAssistant.map((message, index) =>
      index === adjustedAssistantIndex ? liveAssistant : message
    )
  }

  if (adjustedOwnerIndex >= 0) {
    return [
      ...withoutDuplicateLiveAssistant.slice(0, adjustedOwnerIndex + 1),
      liveAssistant,
      ...withoutDuplicateLiveAssistant.slice(adjustedOwnerIndex + 1),
    ]
  }

  return [...withoutDuplicateLiveAssistant, liveAssistant]
}

export interface ReconnectReplaySelection {
  afterCursor: string
  content: string
  contentBlocks: ContentBlock[]
  preserveExistingState: boolean
  source: 'cache' | 'reset'
}

export function selectReconnectReplayState(params: {
  afterCursor: string
  cachedLiveAssistant?: Pick<ChatMessage, 'content' | 'contentBlocks'> | null
  currentContent: string
  currentBlocks: ContentBlock[]
}): ReconnectReplaySelection {
  const { afterCursor, cachedLiveAssistant, currentContent, currentBlocks } = params
  if (isZeroStreamCursor(afterCursor)) {
    return {
      afterCursor,
      content: '',
      contentBlocks: [],
      preserveExistingState: false,
      source: 'reset',
    }
  }

  const cachedContent = cachedLiveAssistant?.content ?? ''
  const cachedBlocks = cachedLiveAssistant?.contentBlocks ?? []
  const cachedHasLiveState = cachedContent.length > 0 || cachedBlocks.length > 0
  const cachedIsAhead =
    cachedHasLiveState &&
    cachedContent.length >= currentContent.length &&
    cachedContent.startsWith(currentContent) &&
    cachedBlocks.length >= currentBlocks.length

  if (cachedIsAhead) {
    return {
      afterCursor,
      content: cachedContent,
      contentBlocks: [...cachedBlocks],
      preserveExistingState: true,
      source: 'cache',
    }
  }

  return {
    afterCursor: '0',
    content: '',
    contentBlocks: [],
    preserveExistingState: false,
    source: 'reset',
  }
}

export function getReplayCompletedWorkflowToolCallIds(events: StreamBatchEvent[]): Set<string> {
  const completedToolCallIds = new Set<string>()
  for (const entry of events) {
    const event = entry.event
    if (event.type !== MothershipStreamV1EventType.tool) continue
    const payload = event.payload
    if (!('phase' in payload)) continue
    if (payload.phase !== MothershipStreamV1ToolPhase.result) continue
    // Client-executed tools (workflow runs, browser actions) must never
    // re-fire when their completed call replays after reconnect/reload.
    if (
      typeof payload.toolCallId === 'string' &&
      (isWorkflowToolName(payload.toolName) || isBrowserToolName(payload.toolName))
    ) {
      completedToolCallIds.add(payload.toolCallId)
    }
  }
  return completedToolCallIds
}

function buildRecoverySubjectKey(
  chatId: string | undefined,
  selectedChatId: string | undefined
): string {
  return `${chatId ?? ''}:${selectedChatId ?? ''}`
}

const sseEncoder = new TextEncoder()
function buildReplayStream(events: StreamBatchEvent[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const payload = events.map((entry) => `data: ${JSON.stringify(entry.event)}\n\n`).join('')
      controller.enqueue(sseEncoder.encode(payload))
      controller.close()
    },
  })
}

/** Adds a workflow to the React Query cache with a top-insertion sort order if it doesn't already exist. */
function ensureWorkflowInRegistry(resourceId: string, title: string, workspaceId: string): boolean {
  const workflows = getWorkflows(workspaceId)
  if (workflows.some((w) => w.id === resourceId)) return false
  const sortOrder = getTopInsertionSortOrder(
    Object.fromEntries(workflows.map((w) => [w.id, w])),
    getFolderMap(workspaceId),
    workspaceId,
    null
  )
  const newMetadata: WorkflowMetadata = {
    id: resourceId,
    name: title,
    lastModified: new Date(),
    createdAt: new Date(),
    workspaceId,
    folderId: null,
    sortOrder,
  }
  const queryClient = getQueryClient()
  const key = workflowKeys.list(workspaceId, 'active')
  queryClient.setQueryData<WorkflowMetadata[]>(key, (current) => {
    const next = current ?? workflows
    if (next.some((workflow) => workflow.id === resourceId)) {
      return next
    }

    return [...next, newMetadata]
  })
  void invalidateWorkflowSelectors(queryClient, workspaceId)
  return true
}

export interface UseChatOptions {
  onResourceEvent?: () => void
  apiPath?: string
  stopPath?: string
  workflowId?: string
  onToolResult?: (toolName: string, success: boolean, result: unknown) => void
  onTitleUpdate?: () => void
  onStreamEnd?: (chatId: string, messages: ChatMessage[]) => void
  initialActiveResourceId?: string | null
  /**
   * Controlled binding for the active resource id, supplied as a
   * `[value, setValue]` tuple (e.g. a URL-backed nuqs `useQueryState`). When
   * provided, it is the single source of truth for the selected resource — the
   * hook reads and writes it directly instead of owning the state internally,
   * so no effect-sync mirror is needed. When omitted, `useChat` owns the state
   * via local `useState` (seeded from `initialActiveResourceId`); this is the
   * mode used by the socket-synced workflow editor copilot, whose resource
   * selection intentionally stays out of the URL.
   */
  activeResourceState?: [string | null, Dispatch<SetStateAction<string | null>>]
  /** Fired when the server's `traceparent` response header arrives, before any stream content. */
  onRequestStarted?: (info: { requestId: string; userMessageId: string }) => void
}

interface ActiveStreamRecovery {
  subjectKey: string
  controller: AbortController
  promise: Promise<void>
}

type StopGenerationMode = 'normal' | 'queued-handoff'

interface StopGenerationOptions {
  mode?: StopGenerationMode
}

export function getMothershipUseChatOptions(
  options: Pick<
    UseChatOptions,
    | 'onResourceEvent'
    | 'onStreamEnd'
    | 'initialActiveResourceId'
    | 'activeResourceState'
    | 'onRequestStarted'
  > = {}
): UseChatOptions {
  return {
    apiPath: MOTHERSHIP_CHAT_API_PATH,
    stopPath: '/api/mothership/chat/stop',
    ...options,
  }
}

export function getWorkflowCopilotUseChatOptions(
  options: Pick<
    UseChatOptions,
    'workflowId' | 'onToolResult' | 'onTitleUpdate' | 'onStreamEnd' | 'onRequestStarted'
  > = {}
): UseChatOptions {
  return {
    apiPath: MOTHERSHIP_CHAT_API_PATH,
    stopPath: '/api/mothership/chat/stop',
    ...options,
  }
}

export function useChat(
  workspaceId: string,
  initialChatId?: string,
  options?: UseChatOptions
): UseChatReturn {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedChatId, setResolvedChatId] = useState<string | undefined>(initialChatId)
  const [queuedHandoffRecoveryEpoch, setQueuedHandoffRecoveryEpoch] = useState(0)
  const [resources, setResources] = useState<MothershipResource[]>([])
  const internalActiveResourceState = useState<string | null>(
    options?.initialActiveResourceId ?? null
  )
  /**
   * Prefer a caller-supplied controlled binding (URL-backed nuqs on the home/Chat
   * surface) so the URL is the single source of truth; fall back to internal state
   * for the workflow editor copilot, which keeps resource selection out of the URL.
   */
  const [activeResourceId, setActiveResourceId] =
    options?.activeResourceState ?? internalActiveResourceState
  const [genericResourceData, setGenericResourceData] = useState<GenericResourceData | null>(null)
  const onResourceEventRef = useRef(options?.onResourceEvent)
  const revealedSimKeysRef = useRef<RevealedSimKeysByMessage>(new Map())
  onResourceEventRef.current = options?.onResourceEvent
  const apiPathRef = useRef(options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH)
  apiPathRef.current = options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH
  const stopPathRef = useRef(options?.stopPath ?? '/api/mothership/chat/stop')
  stopPathRef.current = options?.stopPath ?? '/api/mothership/chat/stop'
  const pendingStopPromiseRef = useRef<Promise<void> | null>(null)
  const pendingStopModeRef = useRef<StopGenerationMode | null>(null)
  const workflowIdRef = useRef(options?.workflowId)
  workflowIdRef.current = options?.workflowId
  const onToolResultRef = useRef(options?.onToolResult)
  onToolResultRef.current = options?.onToolResult
  const onTitleUpdateRef = useRef(options?.onTitleUpdate)
  onTitleUpdateRef.current = options?.onTitleUpdate
  const onStreamEndRef = useRef(options?.onStreamEnd)
  onStreamEndRef.current = options?.onStreamEnd
  const onRequestStartedRef = useRef(options?.onRequestStarted)
  onRequestStartedRef.current = options?.onRequestStarted

  const getCurrentRequestId = useCallback(() => {
    const traceId = streamTraceparentRef.current?.split('-')[1] ?? ''
    return /^[0-9a-f]{32}$/.test(traceId) ? traceId : undefined
  }, [])

  const clearQueueDispatchState = useCallback(() => {
    queueDispatchEpochRef.current++
    queueDispatchActionsRef.current = []
    queuedMessageDispatchIdsRef.current.clear()
    userRemovedDuringDispatchRef.current.clear()
    queueDispatchTaskRef.current = null
    setDispatchingHeadId(null)
  }, [])
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources
  const pendingPersistResourceKeysRef = useRef<Set<string>>(new Set())
  const inFlightResourceAddsRef = useRef<Map<string, Promise<unknown>>>(new Map())
  const reorderNeededAfterFlushRef = useRef(false)

  // Derive the effective active resource ID — auto-selects the last resource when the stored ID is
  // absent or no longer in the list, avoiding a separate Effect-based state correction loop.
  const effectiveActiveResourceId = useMemo(() => {
    if (resources.length === 0) return null
    if (activeResourceId && resources.some((r) => r.id === activeResourceId))
      return activeResourceId
    return resources[resources.length - 1].id
  }, [resources, activeResourceId])

  const activeResourceIdRef = useRef(effectiveActiveResourceId)
  activeResourceIdRef.current = effectiveActiveResourceId
  const {
    previewSession,
    previewSessionRef,
    previewSessionsRef,
    activePreviewSessionIdRef,
    latestPreviewTargetToolCallIdRef,
    previewActivationOwnerRef,
    completedPreviewResourceHandoffRef,
    shouldAutoActivatePreviewSession,
    applyPreviewSessionUpdate,
    removePreviewSessionImmediate,
    reconcileTerminalPreviewSessions,
    resetEphemeralPreviewState,
    promoteFileResource,
    seedPreviewSessions,
    onPreviewPhase,
  } = useFilePreviewController({
    workspaceId,
    setResources,
    setActiveResourceId,
    activeResourceIdRef,
  })

  const upsertChatHistory = useCallback(
    (chatId: string, updater: (current: MothershipChatHistory) => MothershipChatHistory) => {
      queryClient.setQueryData<MothershipChatHistory>(
        mothershipChatKeys.detail(chatId),
        (current) => {
          const base: MothershipChatHistory = current ?? {
            id: chatId,
            title: null,
            messages: [],
            activeStreamId: null,
            resources: resourcesRef.current,
          }
          return updater(base)
        }
      )
    },
    [queryClient]
  )

  // Sentinel used while no `chatId` is resolved; `adoptResolvedChatId`
  // migrates this bucket onto the real chatId on first send. Rotated on
  // home reset so a new pending chat starts with an empty bucket.
  const pendingChatKeyRef = useRef<string>(`pending::${generateShortId()}`)
  const [chatKey, setChatKey] = useState<string>(initialChatId ?? pendingChatKeyRef.current)
  const chatKeyRef = useRef<string>(chatKey)
  chatKeyRef.current = chatKey
  const messageQueue = useMothershipQueueStore(
    (state) => state.queues[chatKey] ?? EMPTY_MESSAGE_QUEUE
  )
  const editingQueuedId = useMothershipQueueStore((state) => state.editing[chatKey] ?? null)
  const [dispatchingHeadId, setDispatchingHeadId] = useState<string | null>(null)
  const queuedMessageDispatchIdsRef = useRef<Set<string>>(new Set())
  // Ids the user explicitly removed while a dispatch was in flight — used to
  // suppress the dispatch's failure-restore path, which would otherwise undo
  // the user's removal silently.
  const userRemovedDuringDispatchRef = useRef<Set<string>>(new Set())
  const queueDispatchActionsRef = useRef<QueueDispatchAction[]>([])
  const queueDispatchTaskRef = useRef<Promise<void> | null>(null)
  const queueDispatchEpochRef = useRef(0)
  const queueDispatchLoopRef = useRef<() => Promise<void>>(async () => {})
  const enqueueQueueDispatchRef = useRef<(action: QueueDispatchActionInput) => Promise<void>>(
    async () => {}
  )

  const processSSEStreamRef = useRef<
    (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number,
      options?: {
        preserveExistingState?: boolean
        suppressedWorkflowToolStartIds?: ReadonlySet<string>
        targetChatId?: string
        shouldContinue?: () => boolean
      }
    ) => Promise<{ sawStreamError: boolean; sawComplete: boolean }>
  >(async () => ({ sawStreamError: false, sawComplete: false }))
  const attachToExistingStreamRef = useRef<
    (opts: {
      streamId: string
      assistantId: string
      expectedGen: number
      initialBatch?: StreamBatchResponse | null
      afterCursor?: string
      targetChatId?: string
      shouldContinue?: () => boolean
    }) => Promise<{ error: boolean; aborted: boolean }>
  >(async () => ({ error: false, aborted: true }))
  const retryReconnectRef = useRef<
    (opts: {
      streamId: string
      assistantId: string
      gen: number
      targetChatId?: string
      shouldContinue?: () => boolean
    }) => Promise<boolean>
  >(async () => false)
  const finalizeRef = useRef<(options?: { error?: boolean; targetChatId?: string }) => void>(
    () => {}
  )
  const recoveringQueuedSendHandoffRef = useRef<ActiveQueuedSendHandoffRecovery | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  /** Panel/chat selection — drives createNewChat + request chatId; may differ from chatIdRef while a stream is still finishing. */
  const selectedChatIdRef = useRef<string | undefined>(initialChatId)
  selectedChatIdRef.current = initialChatId
  const appliedChatHistoryKeyRef = useRef<string | undefined>(undefined)
  const activeTurnRef = useRef<ActiveTurn | null>(null)
  const pendingUserMsgRef = useRef<PersistedMessage | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  // W3C traceparent from the chat POST response; echoed on
  // abort/stop/confirm/replay so side-channel calls join the same
  // trace instead of becoming disconnected roots.
  const streamTraceparentRef = useRef<string | undefined>(undefined)
  // The `request.id` from the active stream's trace events. Forwarded
  // to /chat/stop so the persisted aborted message carries it (keeps
  // the copy-request-ID button functional after refetch).
  const streamRequestIdRef = useRef<string | undefined>(undefined)
  const locallyTerminalStreamIdRef = useRef<string | undefined>(undefined)
  const lastCursorRef = useRef('0')
  const activeStreamReturnRecoveryRef = useRef<ActiveStreamRecovery | null>(null)
  const sendingRef = useRef(false)
  const streamGenRef = useRef(0)
  const streamingContentRef = useRef('')
  const streamingBlocksRef = useRef<ContentBlock[]>([])
  const handledClientWorkflowToolIdsRef = useRef<Set<string>>(new Set())
  const handledClientLocalFilesystemToolIdsRef = useRef<Set<string>>(new Set())
  const recoveringClientWorkflowToolIdsRef = useRef<Set<string>>(new Set())
  const executionStream = useExecutionStream()
  const isHomePage = pathname.endsWith('/home')

  const setTransportIdle = useCallback(() => {
    sendingRef.current = false
    setIsSending(false)
    setIsReconnecting(false)
  }, [])

  const setTransportStreaming = useCallback(() => {
    sendingRef.current = true
    setIsSending(true)
    setIsReconnecting(false)
  }, [])

  const setTransportReconnecting = useCallback(() => {
    sendingRef.current = true
    setIsSending(true)
    setIsReconnecting(true)
  }, [])

  const cancelActiveStreamRecovery = useCallback(() => {
    const recovery = activeStreamReturnRecoveryRef.current
    if (!recovery) return
    recovery.controller.abort('superseded_recovery')
    activeStreamReturnRecoveryRef.current = null
  }, [])

  const cancelActiveStreamReader = useCallback(() => {
    const reader = streamReaderRef.current
    streamReaderRef.current = null
    void reader?.cancel().catch((error) => {
      logger.warn('Failed to cancel detached stream reader', {
        error: toError(error).message,
      })
    })
  }, [])

  const resetStreamingBuffers = useCallback(() => {
    streamingContentRef.current = ''
    streamingBlocksRef.current = []
  }, [])

  const applyReconnectReplaySelection = useCallback(
    (
      streamId: string,
      assistantId: string,
      afterCursor: string,
      options?: { targetChatId?: string; chatHistory?: MothershipChatHistory }
    ): ReconnectReplaySelection => {
      const cachedHistory =
        options?.chatHistory ??
        (options?.targetChatId
          ? queryClient.getQueryData<MothershipChatHistory>(
              mothershipChatKeys.detail(options.targetChatId)
            )
          : undefined)
      const cachedLiveAssistant = cachedHistory?.messages.find(
        (message) => message.id === assistantId
      )
      const selection = selectReconnectReplayState({
        afterCursor,
        cachedLiveAssistant: cachedLiveAssistant ? toDisplayMessage(cachedLiveAssistant) : null,
        currentContent: streamingContentRef.current,
        currentBlocks: streamingBlocksRef.current,
      })

      streamingContentRef.current = selection.content
      streamingBlocksRef.current = selection.contentBlocks
      lastCursorRef.current = selection.afterCursor

      if (selection.afterCursor === '0' && afterCursor !== '0') {
        logger.info('Resetting stream replay cursor after reconnect state mismatch', {
          streamId,
          targetChatId: options?.targetChatId ?? cachedHistory?.id,
          previousCursor: afterCursor,
        })
      }

      return selection
    },
    [queryClient]
  )

  const clearActiveTurn = useCallback(() => {
    activeTurnRef.current = null
    pendingUserMsgRef.current = null
    streamIdRef.current = undefined
    streamRequestIdRef.current = undefined
    streamTraceparentRef.current = undefined
    setCurrentChatTraceparent(undefined)
    lastCursorRef.current = '0'
    resetStreamingBuffers()
  }, [resetStreamingBuffers])

  const resetHomeChatState = useCallback(() => {
    cancelActiveStreamRecovery()
    streamGenRef.current++
    cancelActiveStreamReader()
    chatIdRef.current = undefined
    lastCursorRef.current = '0'
    locallyTerminalStreamIdRef.current = undefined
    clearActiveTurn()
    setResolvedChatId(undefined)
    appliedChatHistoryKeyRef.current = undefined
    abortControllerRef.current = null
    setPendingMessages([])
    setError(null)
    setTransportIdle()
    setResources([])
    setActiveResourceId(null)
    pendingPersistResourceKeysRef.current.clear()
    inFlightResourceAddsRef.current.clear()
    reorderNeededAfterFlushRef.current = false
    resetEphemeralPreviewState()
    // Editing binds to this hook's composer — release it before rotating chatKey.
    useMothershipQueueStore.getState().setEditing(chatKeyRef.current, null)
    pendingChatKeyRef.current = `pending::${generateShortId()}`
    chatKeyRef.current = pendingChatKeyRef.current
    setChatKey(pendingChatKeyRef.current)
    clearQueueDispatchState()
  }, [
    cancelActiveStreamRecovery,
    cancelActiveStreamReader,
    clearActiveTurn,
    clearQueueDispatchState,
    resetEphemeralPreviewState,
    setTransportIdle,
  ])

  const flushPendingResources = useCallback(async (chatId: string) => {
    const pendingKeys = pendingPersistResourceKeysRef.current
    if (pendingKeys.size === 0) return
    const flushPromises: Array<Promise<unknown>> = []
    for (const resource of resourcesRef.current) {
      if (resource.id === 'streaming-file') continue
      const key = `${resource.type}:${resource.id}`
      if (!pendingKeys.has(key)) continue
      pendingKeys.delete(key)
      const promise = requestJson(addMothershipChatResourceContract, {
        body: { chatId, resource },
      })
        .catch((err) => {
          pendingPersistResourceKeysRef.current.add(key)
          logger.warn('Failed to flush pending resource; will retry on next hydration', err)
        })
        .finally(() => {
          inFlightResourceAddsRef.current.delete(key)
        })
      inFlightResourceAddsRef.current.set(key, promise)
      flushPromises.push(promise)
    }
    if (flushPromises.length === 0) return
    await Promise.allSettled(flushPromises)
    if (!reorderNeededAfterFlushRef.current) return
    reorderNeededAfterFlushRef.current = false
    const localOrder = resourcesRef.current.filter(
      (r) =>
        r.id !== 'streaming-file' && !pendingPersistResourceKeysRef.current.has(`${r.type}:${r.id}`)
    )
    if (localOrder.length === 0) return
    requestJson(reorderMothershipChatResourcesContract, {
      body: { chatId, resources: localOrder },
    }).catch((err) => {
      logger.warn('Failed to sync resource order after flush', err)
    })
  }, [])

  const adoptResolvedChatId = useCallback(
    (chatId: string, options?: { replaceHomeHistory?: boolean; invalidateList?: boolean }) => {
      const selectedChatId = selectedChatIdRef.current
      chatIdRef.current = chatId
      // Migrate from the pending sentinel (not chatKeyRef — user may have
      // navigated to a different chat mid-stream, and we mustn't steal it).
      if (pendingChatKeyRef.current !== chatId) {
        useMothershipQueueStore.getState().migrate(pendingChatKeyRef.current, chatId)
      }
      // Only rebind chatKey if the user is still viewing the resolved chat.
      const stillViewingResolvedChat = !selectedChatId || selectedChatId === chatId
      if (stillViewingResolvedChat && chatKeyRef.current !== chatId) {
        chatKeyRef.current = chatId
        setChatKey(chatId)
      }
      if (!selectedChatId || selectedChatId === chatId) {
        setResolvedChatId(chatId)
      }
      if (
        options?.replaceHomeHistory &&
        !selectedChatId &&
        !workflowIdRef.current &&
        typeof window !== 'undefined'
      ) {
        window.history.replaceState(null, '', `/workspace/${workspaceId}/chat/${chatId}`)
      }
      if (options?.invalidateList) {
        queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
      }
      flushPendingResources(chatId)
    },
    [flushPendingResources, queryClient, workspaceId]
  )

  const { data: chatHistory } = useMothershipChatHistory(resolvedChatId)
  const messages = useMemo(() => {
    const source = chatHistory?.messages.map(toDisplayMessage) ?? pendingMessages
    return source.map((m) => restoreRevealedSimKeysForMessage(m, revealedSimKeysRef.current))
  }, [chatHistory, pendingMessages])
  const addResource = useCallback((resource: MothershipResource): boolean => {
    if (resourcesRef.current.some((r) => r.type === resource.type && r.id === resource.id)) {
      return false
    }

    setResources((prev) => {
      const exists = prev.some((r) => r.type === resource.type && r.id === resource.id)
      if (exists) return prev
      return [...prev, resource]
    })
    setActiveResourceId(resource.id)

    // Ephemeral panels (streaming file preview, live browser session) are
    // in-memory only — never persisted to the chat's resource list.
    if (resource.id === 'streaming-file' || resource.type === 'browser') {
      return true
    }

    const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
    const key = `${resource.type}:${resource.id}`
    if (persistChatId) {
      const promise = requestJson(addMothershipChatResourceContract, {
        body: { chatId: persistChatId, resource },
      })
        .catch((err) => {
          pendingPersistResourceKeysRef.current.add(key)
          logger.warn('Failed to persist resource; will retry on next hydration', err)
        })
        .finally(() => {
          inFlightResourceAddsRef.current.delete(key)
        })
      inFlightResourceAddsRef.current.set(key, promise)
    } else {
      pendingPersistResourceKeysRef.current.add(key)
    }
    return true
  }, [])

  const removeResource = useCallback((resourceType: MothershipResourceType, resourceId: string) => {
    setResources((prev) => prev.filter((r) => !(r.type === resourceType && r.id === resourceId)))
    setActiveResourceId((prev) => (prev === resourceId ? null : prev))

    // Ephemeral panels were never persisted; nothing to delete server-side.
    if (isEphemeralResource({ type: resourceType, id: resourceId, title: '' })) return

    const key = `${resourceType}:${resourceId}`
    const wasPending = pendingPersistResourceKeysRef.current.delete(key)
    const inFlightAdd = inFlightResourceAddsRef.current.get(key)
    if (wasPending && !inFlightAdd) return

    const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
    if (!persistChatId) return
    const fireDelete = () => {
      requestJson(removeMothershipChatResourceContract, {
        body: { chatId: persistChatId, resourceType, resourceId },
      }).catch((err) => {
        logger.warn('Failed to persist resource removal', err)
      })
    }
    if (inFlightAdd) {
      inFlightAdd.finally(fireDelete)
    } else {
      fireDelete()
    }
  }, [])

  const reorderResources = useCallback((newOrder: MothershipResource[]) => {
    setResources(newOrder)
    const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
    if (!persistChatId) return
    const pendingKeys = pendingPersistResourceKeysRef.current
    const inFlightAdds = inFlightResourceAddsRef.current
    const hasUnsyncedAdds = newOrder.some((r) => {
      const key = `${r.type}:${r.id}`
      return pendingKeys.has(key) || inFlightAdds.has(key)
    })
    if (hasUnsyncedAdds) {
      reorderNeededAfterFlushRef.current = true
      if (pendingKeys.size === 0 && inFlightAdds.size > 0) {
        Promise.allSettled(Array.from(inFlightAdds.values())).then(() => {
          if (!reorderNeededAfterFlushRef.current) return
          reorderNeededAfterFlushRef.current = false
          const chatId = chatIdRef.current ?? selectedChatIdRef.current
          if (!chatId) return
          const order = resourcesRef.current.filter(
            (r) =>
              !isEphemeralResource(r) &&
              !pendingPersistResourceKeysRef.current.has(`${r.type}:${r.id}`)
          )
          if (order.length === 0) return
          requestJson(reorderMothershipChatResourcesContract, {
            body: { chatId, resources: order },
          }).catch((err) => {
            logger.warn('Failed to sync resource order after in-flight ADDs', err)
          })
        })
      }
      return
    }
    const persistableResources = newOrder.filter((r) => !isEphemeralResource(r))
    if (persistableResources.length === 0) return
    requestJson(reorderMothershipChatResourcesContract, {
      body: { chatId: persistChatId, resources: persistableResources },
    }).catch((err) => {
      logger.warn('Failed to persist resource reorder', err)
    })
  }, [])

  const ensureWorkflowToolResource = useCallback(
    (toolArgs: Record<string, unknown>): string | undefined => {
      const targetWorkflowId =
        typeof toolArgs.workflowId === 'string'
          ? toolArgs.workflowId
          : useWorkflowRegistry.getState().activeWorkflowId

      if (!targetWorkflowId) {
        return undefined
      }

      const meta = getWorkflowById(workspaceId, targetWorkflowId)
      const wasAdded = addResource({
        type: 'workflow',
        id: targetWorkflowId,
        title: meta?.name ?? 'Workflow',
      })
      if (!wasAdded && activeResourceIdRef.current !== targetWorkflowId) {
        setActiveResourceId(targetWorkflowId)
      }
      onResourceEventRef.current?.()

      return targetWorkflowId
    },
    [addResource, workspaceId]
  )

  const startClientWorkflowTool = useCallback(
    (toolCallId: string, toolName: string, toolArgs: Record<string, unknown>) => {
      if (!isWorkflowToolName(toolName)) {
        return
      }
      if (handledClientWorkflowToolIdsRef.current.has(toolCallId)) {
        return
      }
      if (recoveringClientWorkflowToolIdsRef.current.has(toolCallId)) {
        return
      }
      handledClientWorkflowToolIdsRef.current.add(toolCallId)

      ensureWorkflowToolResource(toolArgs)
      executeRunToolOnClient(toolCallId, toolName, toolArgs)
    },
    [ensureWorkflowToolResource]
  )

  const startClientLocalFilesystemTool = useCallback(
    (toolCallId: string, toolName: string, toolArgs: Record<string, unknown>) => {
      if (!isLocalFilesystemToolName(toolName)) {
        return
      }
      if (handledClientLocalFilesystemToolIdsRef.current.has(toolCallId)) {
        return
      }
      handledClientLocalFilesystemToolIdsRef.current.add(toolCallId)
      executeLocalFilesystemTool(toolCallId, toolName, toolArgs, {
        workspaceId,
        chatId: chatIdRef.current ?? selectedChatIdRef.current,
      })
    },
    [workspaceId]
  )

  const startClientBrowserTool = useCallback(
    (toolCallId: string, toolName: string, toolArgs: Record<string, unknown>, eventTs?: string) => {
      if (!isBrowserToolName(toolName)) {
        return
      }
      // Surface the live browser panel the first time the agent touches the
      // browser; addResource activates it and dedupes on subsequent calls.
      if (addResource({ type: 'browser', id: BROWSER_SESSION_RESOURCE_ID, title: 'Browser' })) {
        onResourceEventRef.current?.()
      }
      // Replay/exactly-once guarding lives in executeBrowserToolOnClient
      // (sessionStorage-backed, so reloads cannot re-run an action).
      executeBrowserToolOnClient(toolCallId, toolName, toolArgs, eventTs)
    },
    [addResource]
  )

  const recoverPendingClientWorkflowTools = useCallback(
    async (nextMessages: ChatMessage[]) => {
      const pending: ToolCallInfo[] = []

      for (const message of nextMessages) {
        for (const block of message.contentBlocks ?? []) {
          const toolCall = block.toolCall
          if (!toolCall || !isWorkflowToolName(toolCall.name)) continue
          if (toolCall.status !== 'executing') continue
          if (
            handledClientWorkflowToolIdsRef.current.has(toolCall.id) ||
            recoveringClientWorkflowToolIdsRef.current.has(toolCall.id)
          ) {
            continue
          }
          recoveringClientWorkflowToolIdsRef.current.add(toolCall.id)
          pending.push(toolCall)
        }
      }

      for (const toolCall of pending) {
        try {
          const toolArgs = toolCall.params ?? {}
          const targetWorkflowId = ensureWorkflowToolResource(toolArgs)

          if (targetWorkflowId) {
            const rebound = await bindRunToolToExecution(toolCall.id, targetWorkflowId)
            if (rebound) {
              handledClientWorkflowToolIdsRef.current.add(toolCall.id)
              continue
            }
          }

          recoveringClientWorkflowToolIdsRef.current.delete(toolCall.id)
          startClientWorkflowTool(toolCall.id, toolCall.name, toolArgs)
        } finally {
          recoveringClientWorkflowToolIdsRef.current.delete(toolCall.id)
        }
      }
    },
    [ensureWorkflowToolResource, startClientWorkflowTool]
  )

  useEffect(() => {
    const streamOwnerId = chatIdRef.current
    const navigatedToDifferentChat =
      sendingRef.current &&
      initialChatId !== streamOwnerId &&
      (initialChatId !== undefined || streamOwnerId !== undefined)
    if (sendingRef.current) {
      if (navigatedToDifferentChat) {
        const abandonedChatId = streamOwnerId
        // Detach the current UI from the old stream without cancelling it on the server.
        // Reopening that chat later will reconnect through the existing chatHistory flow.
        cancelActiveStreamRecovery()
        streamGenRef.current++
        cancelActiveStreamReader()
        abortControllerRef.current = null
        clearActiveTurn()
        setTransportIdle()
        if (abandonedChatId) {
          queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(abandonedChatId) })
        }
      } else {
        setResolvedChatId(initialChatId)
        return
      }
    }
    cancelActiveStreamRecovery()
    cancelActiveStreamReader()
    chatIdRef.current = initialChatId
    lastCursorRef.current = '0'
    locallyTerminalStreamIdRef.current = undefined
    clearActiveTurn()
    setResolvedChatId(initialChatId)
    appliedChatHistoryKeyRef.current = undefined
    setPendingMessages([])
    setError(null)
    setTransportIdle()
    setResources([])
    setActiveResourceId(null)
    pendingPersistResourceKeysRef.current.clear()
    inFlightResourceAddsRef.current.clear()
    reorderNeededAfterFlushRef.current = false
    resetEphemeralPreviewState()
    // Rotate the bucket key; the previous chat's queue stays in the store.
    // Release editing on the chat we're leaving (composer-scoped).
    if (chatKeyRef.current !== (initialChatId ?? '')) {
      useMothershipQueueStore.getState().setEditing(chatKeyRef.current, null)
    }
    if (initialChatId) {
      if (chatKeyRef.current !== initialChatId) {
        chatKeyRef.current = initialChatId
        setChatKey(initialChatId)
      }
    } else {
      pendingChatKeyRef.current = `pending::${generateShortId()}`
      chatKeyRef.current = pendingChatKeyRef.current
      setChatKey(pendingChatKeyRef.current)
    }
    clearQueueDispatchState()
  }, [
    initialChatId,
    queryClient,
    resetEphemeralPreviewState,
    clearQueueDispatchState,
    clearActiveTurn,
    setTransportIdle,
    cancelActiveStreamRecovery,
    cancelActiveStreamReader,
  ])

  useEffect(() => {
    initBrowserAgentTransport()
  }, [])

  useEffect(() => {
    if (workflowIdRef.current) return
    if (!isHomePage || !chatIdRef.current) return
    resetHomeChatState()
  }, [isHomePage, resetHomeChatState])

  useEffect(() => {
    if (!chatHistory) return

    const hydrationKey = buildChatHistoryHydrationKey(chatHistory)
    if (appliedChatHistoryKeyRef.current === hydrationKey) return

    const activeStreamId = chatHistory.activeStreamId
    appliedChatHistoryKeyRef.current = hydrationKey
    const mappedMessages = chatHistory.messages.map(toDisplayMessage)
    const snapshotEvents = Array.isArray(chatHistory.streamSnapshot?.events)
      ? chatHistory.streamSnapshot.events
      : []
    const snapshotHasCompleteEvent = snapshotEvents.some(
      (entry) => entry?.event?.type === MothershipStreamV1EventType.complete
    )
    const shouldReconnectActiveStream =
      Boolean(activeStreamId) &&
      !sendingRef.current &&
      activeStreamId !== locallyTerminalStreamIdRef.current &&
      !isTerminalStreamStatus(chatHistory.streamSnapshot?.status) &&
      !snapshotHasCompleteEvent

    if (!activeStreamId && locallyTerminalStreamIdRef.current) {
      locallyTerminalStreamIdRef.current = undefined
    }

    void recoverPendingClientWorkflowTools(mappedMessages)

    const hasPersistedStreamingFile = chatHistory.resources.some((r) => r.id === 'streaming-file')
    if (hasPersistedStreamingFile) {
      requestJson(removeMothershipChatResourceContract, {
        body: {
          chatId: chatHistory.id,
          resourceType: 'file',
          resourceId: 'streaming-file',
        },
      }).catch(() => {})
    }

    flushPendingResources(chatHistory.id)

    const persistedResources = chatHistory.resources.filter((r) => r.id !== 'streaming-file')
    const serverKeys = new Set(persistedResources.map((r) => `${r.type}:${r.id}`))
    const localOnly = resourcesRef.current.filter(
      (r) => r.id !== 'streaming-file' && !serverKeys.has(`${r.type}:${r.id}`)
    )
    // Server order is authoritative for persisted resources, but local-only
    // items (pending-persist adds, ephemeral panels like the live browser)
    // keep their current on-screen position — hydration reruns on every send
    // and stream completion, and appending them at the end made those tabs
    // visibly jump/flash each time.
    const mergedResources = [...persistedResources]
    for (const resource of localOnly) {
      const currentIndex = resourcesRef.current.findIndex(
        (r) => r.type === resource.type && r.id === resource.id
      )
      const insertAt =
        currentIndex < 0 ? mergedResources.length : Math.min(currentIndex, mergedResources.length)
      mergedResources.splice(insertAt, 0, resource)
    }
    const resourcesUnchanged =
      mergedResources.length === resourcesRef.current.length &&
      mergedResources.every(
        (resource, index) =>
          resourcesRef.current[index].type === resource.type &&
          resourcesRef.current[index].id === resource.id &&
          resourcesRef.current[index].title === resource.title
      )

    if (mergedResources.length > 0) {
      const hydratedActiveResourceId =
        activeResourceIdRef.current &&
        mergedResources.some((resource) => resource.id === activeResourceIdRef.current)
          ? activeResourceIdRef.current
          : mergedResources[mergedResources.length - 1].id
      // Replacing the array with an identical one still re-renders the tab
      // strip and panel — skip the no-op so open panels don't flash.
      if (!resourcesUnchanged) {
        activeResourceIdRef.current = hydratedActiveResourceId
        setResources(mergedResources)
        setActiveResourceId(hydratedActiveResourceId)
      }

      for (const resource of persistedResources) {
        if (resource.type !== 'workflow') continue
        ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
      }
    } else if (hasPersistedStreamingFile) {
      activeResourceIdRef.current = null
      setResources([])
      setActiveResourceId(null)
    }

    const snapshotPreviewSessions = Array.isArray(chatHistory.streamSnapshot?.previewSessions)
      ? (chatHistory.streamSnapshot.previewSessions as FilePreviewSession[])
      : []
    if (snapshotPreviewSessions.length > 0) {
      seedPreviewSessions(snapshotPreviewSessions)
    }

    if (shouldReconnectActiveStream && activeStreamId) {
      const gen = ++streamGenRef.current
      const abortController = new AbortController()
      const previousStreamId = streamIdRef.current ?? activeTurnRef.current?.userMessageId
      const reconnectAfterCursor =
        previousStreamId === activeStreamId ? lastCursorRef.current || '0' : '0'
      cancelActiveStreamRecovery()
      const replacedController = abortControllerRef.current
      if (replacedController && !replacedController.signal.aborted) {
        replacedController.abort('superseded_chat_history_reconnect')
      }
      cancelActiveStreamReader()
      abortControllerRef.current = abortController
      streamIdRef.current = activeStreamId
      setTransportReconnecting()

      const assistantId = getLiveAssistantMessageId(activeStreamId)
      let snapshotReplayAfterCursor: string
      if (snapshotEvents.length > 0) {
        streamingContentRef.current = ''
        streamingBlocksRef.current = []
        lastCursorRef.current = '0'
        snapshotReplayAfterCursor = '0'
      } else {
        const replaySelection = applyReconnectReplaySelection(
          activeStreamId,
          assistantId,
          reconnectAfterCursor,
          { targetChatId: chatHistory.id, chatHistory }
        )
        snapshotReplayAfterCursor = replaySelection.afterCursor
      }

      const reconnect = async () => {
        const initialSnapshot = chatHistory.streamSnapshot
        const snapshotEvents = Array.isArray(initialSnapshot?.events)
          ? (initialSnapshot.events as StreamBatchEvent[])
          : []

        let reconnectResult: Awaited<ReturnType<typeof attachToExistingStreamRef.current>> | null =
          null
        const replaySnapshotEvents = snapshotEvents.filter(
          (entry) =>
            !isAlreadyProcessedStreamCursor(String(entry.eventId), snapshotReplayAfterCursor)
        )
        if (replaySnapshotEvents.length > 0) {
          try {
            reconnectResult = await attachToExistingStreamRef.current({
              streamId: activeStreamId,
              assistantId,
              expectedGen: gen,
              initialBatch: {
                success: true,
                events: replaySnapshotEvents,
                previewSessions: snapshotPreviewSessions,
                status: initialSnapshot?.status ?? 'unknown',
              },
              afterCursor: snapshotReplayAfterCursor,
              targetChatId: chatHistory.id,
            })
          } catch (error) {
            logger.warn('Snapshot stream reconnect failed; falling back to retry', {
              chatId: chatHistory.id,
              streamId: activeStreamId,
              error: toError(error).message,
            })
          }
        }

        const succeeded =
          reconnectResult !== null
            ? !reconnectResult.error || reconnectResult.aborted
            : await retryReconnectRef.current({
                streamId: activeStreamId,
                assistantId,
                gen,
                targetChatId: chatHistory.id,
              })
        if (succeeded && streamGenRef.current === gen && sendingRef.current) {
          finalizeRef.current({ targetChatId: chatHistory.id })
          return
        }
        if (succeeded && streamGenRef.current === gen) {
          setTransportIdle()
          abortControllerRef.current = null
          return
        }
        if (!succeeded && streamGenRef.current === gen) {
          try {
            finalizeRef.current({ error: true, targetChatId: chatHistory.id })
          } catch {
            setTransportIdle()
            abortControllerRef.current = null
            setError('Failed to reconnect to the active stream')
          }
        }
      }
      reconnect()
    }
  }, [
    chatHistory,
    workspaceId,
    cancelActiveStreamReader,
    cancelActiveStreamRecovery,
    flushPendingResources,
    queryClient,
    recoverPendingClientWorkflowTools,
    seedPreviewSessions,
    applyReconnectReplaySelection,
    setTransportIdle,
    setTransportReconnecting,
  ])

  const processSSEStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number,
      options?: {
        preserveExistingState?: boolean
        suppressedWorkflowToolStartIds?: ReadonlySet<string>
        targetChatId?: string
        shouldContinue?: () => boolean
      }
    ) => {
      const ctx = createStreamLoopContext({
        workspaceId,
        queryClient,
        assistantId,
        expectedGen,
        options: options ?? {},
        setError,
        setPendingMessages,
        setResolvedChatId,
        setResources,
        setActiveResourceId,
        addResource,
        removeResource,
        startClientWorkflowTool,
        startClientLocalFilesystemTool,
        startClientBrowserTool,
        upsertMothershipChatHistory: upsertChatHistory,
        ensureWorkflowInRegistry,
        onPreviewPhase,
        applyPreviewSessionUpdate,
        removePreviewSessionImmediate,
        promoteFileResource,
        shouldAutoActivatePreviewSession,
        buildAssistantSnapshotMessage,
        hasTerminalPersistedAssistantForStream,
        reconcileLiveAssistantTurn,
        streamGenRef,
        streamingBlocksRef,
        streamingContentRef,
        chatIdRef,
        selectedChatIdRef,
        streamIdRef,
        revealedSimKeysRef,
        pendingUserMsgRef,
        activeTurnRef,
        resourcesRef,
        workflowIdRef,
        activeResourceIdRef,
        onTitleUpdateRef,
        onToolResultRef,
        onResourceEventRef,
        previewSessionRef,
        previewSessionsRef,
        latestPreviewTargetToolCallIdRef,
        activePreviewSessionIdRef,
        completedPreviewResourceHandoffRef,
        previewActivationOwnerRef,
      })
      const { state, ops } = ctx
      if (ops.isStale()) {
        void reader.cancel().catch(() => {})
        return { sawStreamError: false, sawComplete: false }
      }
      streamReaderRef.current = reader

      try {
        await readSSELines(reader, {
          onData: (raw) => {
            if (state.sawCompleteEvent) return true
            if (ops.isStale()) return

            const parsedResult = parsePersistedStreamEventEnvelopeJson(raw)
            if (!parsedResult.ok) {
              const error = createStreamSchemaValidationError(parsedResult, 'Live SSE event.')
              logger.error('Rejected chat SSE event due to client-side schema enforcement', {
                reason: parsedResult.reason,
                message: parsedResult.message,
                errors: parsedResult.errors,
                error: error.message,
              })
              throw error
            }
            const parsed = parsedResult.event

            if (parsed.trace?.requestId && parsed.trace.requestId !== state.streamRequestId) {
              state.streamRequestId = parsed.trace.requestId
              streamRequestIdRef.current = state.streamRequestId
              ops.flush()
            }
            if (parsed.stream?.streamId) {
              streamIdRef.current = parsed.stream.streamId
            }
            const eventCursor = parsed.stream?.cursor ?? String(parsed.seq)
            if (isAlreadyProcessedStreamCursor(eventCursor, lastCursorRef.current)) {
              return
            }
            if (eventCursor) {
              lastCursorRef.current = eventCursor
            }

            logger.debug('SSE event received', parsed)
            dispatchStreamEvent(ctx, parsed)
            if (state.sawCompleteEvent) return true
          },
        })
      } finally {
        if (state.sawStreamError && !state.sawCompleteEvent) {
          applyTurnTerminal(state.model, 'error')
          ops.flush()
        }
        if (state.scheduledTextFlushFrame !== null) {
          cancelAnimationFrame(state.scheduledTextFlushFrame)
          state.scheduledTextFlushFrame = null
          ops.flush()
        }
        if (streamReaderRef.current === reader) {
          streamReaderRef.current = null
        }
      }
      return { sawStreamError: state.sawStreamError, sawComplete: state.sawCompleteEvent }
    },
    [
      workspaceId,
      queryClient,
      addResource,
      removeResource,
      startClientWorkflowTool,
      startClientLocalFilesystemTool,
      startClientBrowserTool,
      upsertChatHistory,
      onPreviewPhase,
      applyPreviewSessionUpdate,
      removePreviewSessionImmediate,
      promoteFileResource,
      shouldAutoActivatePreviewSession,
    ]
  )
  processSSEStreamRef.current = processSSEStream

  const getActiveStreamIdForChat = useCallback(
    async (
      chatId: string,
      signal?: AbortSignal
    ): Promise<{ loaded: boolean; streamId: string | null }> => {
      const cached = queryClient.getQueryData<MothershipChatHistory>(
        mothershipChatKeys.detail(chatId)
      )

      try {
        const fetchSignal = combineAbortSignals(
          signal,
          createTimeoutSignal(CHAT_HISTORY_RECOVERY_TIMEOUT_MS)
        )
        const history = await fetchMothershipChatHistory(chatId, fetchSignal)
        if (signal?.aborted || fetchSignal?.aborted) return { loaded: false, streamId: null }
        queryClient.setQueryData(mothershipChatKeys.detail(chatId), history)
        return { loaded: true, streamId: history.activeStreamId ?? null }
      } catch (error) {
        logger.warn('Failed to load chat history while recovering stream', {
          chatId,
          error: toError(error).message,
        })
        return { loaded: false, streamId: cached?.activeStreamId ?? null }
      }
    },
    [queryClient]
  )

  const fetchStreamBatch = useCallback(
    async (
      streamId: string,
      afterCursor: string,
      signal?: AbortSignal
    ): Promise<StreamBatchResponse> => {
      const fetchSignal = combineAbortSignals(
        signal,
        createTimeoutSignal(STREAM_BATCH_FETCH_TIMEOUT_MS)
      )
      // boundary-raw-fetch: stream-resume batch endpoint requires dynamic per-request traceparent header propagation that the contract layer does not model, and the response is consumed alongside live SSE tail fetches
      const response = await fetch(
        `/api/mothership/chat/stream?streamId=${encodeURIComponent(streamId)}&after=${encodeURIComponent(afterCursor)}&batch=true`,
        {
          signal: fetchSignal,
          ...(streamTraceparentRef.current
            ? { headers: { traceparent: streamTraceparentRef.current } }
            : {}),
        }
      )
      if (!response.ok) {
        throw new Error(`Stream resume batch failed: ${response.status}`)
      }
      return parseStreamBatchResponse(await response.json())
    },
    []
  )

  const resolveChatIdForStream = useCallback(
    async (
      streamId: string,
      options?: { preferExistingChatId?: boolean; signal?: AbortSignal }
    ): Promise<string | undefined> => {
      if (options?.preferExistingChatId !== false) {
        const existingChatId = chatIdRef.current ?? selectedChatIdRef.current
        if (existingChatId) return existingChatId
      }

      const deadline = Date.now() + STREAM_CHAT_ID_RESOLVE_TIMEOUT_MS
      let retryDelayMs = 250
      let lastError: unknown

      while (Date.now() < deadline) {
        if (options?.signal?.aborted) throw createAbortError(options.signal)
        const remainingMs = Math.max(1, deadline - Date.now())
        try {
          const batch = await fetchStreamBatch(
            streamId,
            '0',
            combineAbortSignals(
              options?.signal,
              createTimeoutSignal(Math.min(remainingMs, STREAM_BATCH_FETCH_TIMEOUT_MS))
            )
          )
          const chatId = resolveChatIdFromStreamBatch(batch)
          if (chatId) return chatId
        } catch (error) {
          lastError = error
          if (error instanceof Error && error.name === 'AbortError' && Date.now() >= deadline) {
            break
          }
        }

        await sleepWithAbort(
          Math.min(retryDelayMs, Math.max(1, deadline - Date.now())),
          options?.signal
        )
        retryDelayMs = Math.min(retryDelayMs * 2, 2000)
      }

      if (lastError) {
        logger.warn('Failed to resolve chat id for stream before timeout', {
          streamId,
          error: toError(lastError).message,
        })
      }
      return undefined
    },
    [fetchStreamBatch]
  )

  const seedStreamBatchPreviewSessions = useCallback(
    (batch: StreamBatchResponse) => {
      if (Array.isArray(batch.previewSessions) && batch.previewSessions.length > 0) {
        seedPreviewSessions(batch.previewSessions)
      }
    },
    [seedPreviewSessions]
  )

  const attachToExistingStream = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      expectedGen: number
      initialBatch?: StreamBatchResponse | null
      afterCursor?: string
      targetChatId?: string
      shouldContinue?: () => boolean
    }): Promise<{ error: boolean; aborted: boolean }> => {
      const {
        streamId,
        assistantId,
        expectedGen,
        afterCursor = '0',
        targetChatId,
        shouldContinue,
      } = opts

      const isStaleReconnect = () =>
        streamGenRef.current !== expectedGen ||
        abortControllerRef.current?.signal.aborted === true ||
        shouldContinue?.() === false

      if (isStaleReconnect()) {
        return { error: false, aborted: true }
      }

      const initialReplaySelection: Pick<
        ReconnectReplaySelection,
        'afterCursor' | 'preserveExistingState'
      > = opts.initialBatch
        ? { afterCursor, preserveExistingState: true }
        : applyReconnectReplaySelection(streamId, assistantId, afterCursor, {
            ...(targetChatId ? { targetChatId } : {}),
          })
      let latestCursor = initialReplaySelection.afterCursor
      let preserveNextReplayState = initialReplaySelection.preserveExistingState
      let seedEvents = opts.initialBatch?.events ?? []
      let streamStatus = opts.initialBatch?.status ?? 'unknown'
      let suppressedSeedWorkflowToolStartIds = getReplayCompletedWorkflowToolCallIds(seedEvents)

      setTransportReconnecting()
      setError(null)

      try {
        while (streamGenRef.current === expectedGen) {
          if (seedEvents.length > 0) {
            const replayResult = await processSSEStreamRef.current(
              buildReplayStream(seedEvents).getReader(),
              assistantId,
              expectedGen,
              {
                preserveExistingState: preserveNextReplayState,
                suppressedWorkflowToolStartIds: suppressedSeedWorkflowToolStartIds,
                ...(targetChatId ? { targetChatId } : {}),
                ...(shouldContinue ? { shouldContinue } : {}),
              }
            )
            if (isStaleReconnect()) {
              return { error: false, aborted: true }
            }
            latestCursor = String(seedEvents[seedEvents.length - 1]?.eventId ?? latestCursor)
            lastCursorRef.current = latestCursor
            seedEvents = []
            preserveNextReplayState = true
            suppressedSeedWorkflowToolStartIds = new Set()

            if (replayResult.sawStreamError) {
              return { error: true, aborted: false }
            }
          }

          if (isTerminalStreamStatus(streamStatus)) {
            if (streamStatus === 'error') {
              setError(RECONNECT_TAIL_ERROR)
            }
            return { error: streamStatus === 'error', aborted: false }
          }

          const activeAbort = abortControllerRef.current
          if (!activeAbort || activeAbort.signal.aborted) {
            return { error: false, aborted: true }
          }

          logger.info('Opening live stream tail', { streamId, afterCursor: latestCursor })

          // boundary-raw-fetch: live SSE tail endpoint streams events consumed via response.body.getReader() and processSSEStream
          const sseRes = await fetch(
            `/api/mothership/chat/stream?streamId=${encodeURIComponent(streamId)}&after=${encodeURIComponent(latestCursor)}`,
            {
              signal: activeAbort.signal,
              ...(streamTraceparentRef.current
                ? { headers: { traceparent: streamTraceparentRef.current } }
                : {}),
            }
          )
          if (!sseRes.ok || !sseRes.body) {
            throw new Error(RECONNECT_TAIL_ERROR)
          }

          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }

          setTransportStreaming()

          const liveResult = await processSSEStreamRef.current(
            sseRes.body.getReader(),
            assistantId,
            expectedGen,
            {
              preserveExistingState: preserveNextReplayState,
              ...(targetChatId ? { targetChatId } : {}),
              ...(shouldContinue ? { shouldContinue } : {}),
            }
          )
          preserveNextReplayState = true

          if (liveResult.sawStreamError) {
            return { error: true, aborted: false }
          }

          if (liveResult.sawComplete) {
            return { error: false, aborted: false }
          }

          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }

          setTransportReconnecting()

          latestCursor = lastCursorRef.current || latestCursor

          logger.warn('Live stream ended without terminal event, fetching batch', {
            streamId,
            latestCursor,
          })

          const batch = await fetchStreamBatch(streamId, latestCursor, activeAbort.signal)
          if (isStaleReconnect()) {
            return { error: false, aborted: true }
          }
          seedStreamBatchPreviewSessions(batch)
          seedEvents = batch.events
          streamStatus = batch.status
          suppressedSeedWorkflowToolStartIds = getReplayCompletedWorkflowToolCallIds(seedEvents)

          if (batch.events.length > 0) {
            latestCursor = String(batch.events[batch.events.length - 1].eventId)
          }

          if (batch.events.length === 0 && !isTerminalStreamStatus(batch.status)) {
            if (activeAbort.signal.aborted || streamGenRef.current !== expectedGen) {
              return { error: false, aborted: true }
            }
          }
        }

        return { error: false, aborted: true }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { error: false, aborted: true }
        }
        throw err
      } finally {
        if (streamGenRef.current === expectedGen) {
          if (sendingRef.current) {
            setIsReconnecting(false)
          } else {
            setTransportIdle()
          }
        }
      }
    },
    [
      applyReconnectReplaySelection,
      fetchStreamBatch,
      seedStreamBatchPreviewSessions,
      setTransportIdle,
      setTransportReconnecting,
      setTransportStreaming,
    ]
  )
  attachToExistingStreamRef.current = attachToExistingStream

  const resumeOrFinalize = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      gen: number
      afterCursor: string
      signal?: AbortSignal
      targetChatId?: string
      shouldContinue?: () => boolean
    }): Promise<void> => {
      const { streamId, assistantId, gen, afterCursor, signal, targetChatId, shouldContinue } = opts

      if (streamGenRef.current !== gen || signal?.aborted || shouldContinue?.() === false) return

      const replaySelection = applyReconnectReplaySelection(streamId, assistantId, afterCursor, {
        ...(targetChatId ? { targetChatId } : {}),
      })
      const batch = await fetchStreamBatch(streamId, replaySelection.afterCursor, signal)
      if (streamGenRef.current !== gen || shouldContinue?.() === false) return
      seedStreamBatchPreviewSessions(batch)

      if (isTerminalStreamStatus(batch.status)) {
        if (batch.events.length > 0) {
          await processSSEStreamRef.current(
            buildReplayStream(batch.events).getReader(),
            assistantId,
            gen,
            {
              preserveExistingState: replaySelection.preserveExistingState,
              suppressedWorkflowToolStartIds: getReplayCompletedWorkflowToolCallIds(batch.events),
              ...(targetChatId ? { targetChatId } : {}),
              ...(shouldContinue ? { shouldContinue } : {}),
            }
          )
        }
        if (streamGenRef.current !== gen || shouldContinue?.() === false) return
        finalizeRef.current({
          ...(batch.status === 'error' ? { error: true } : {}),
          ...(targetChatId ? { targetChatId } : {}),
        })
        return
      }

      const reconnectResult = await attachToExistingStream({
        streamId,
        assistantId,
        expectedGen: gen,
        initialBatch: batch,
        ...(targetChatId ? { targetChatId } : {}),
        ...(shouldContinue ? { shouldContinue } : {}),
        afterCursor:
          batch.events.length > 0
            ? String(batch.events[batch.events.length - 1].eventId)
            : replaySelection.afterCursor,
      })

      if (
        streamGenRef.current === gen &&
        !reconnectResult.aborted &&
        shouldContinue?.() !== false
      ) {
        finalizeRef.current({
          ...(reconnectResult.error ? { error: true } : {}),
          ...(targetChatId ? { targetChatId } : {}),
        })
      } else if (
        streamGenRef.current === gen &&
        reconnectResult.aborted &&
        !sendingRef.current &&
        shouldContinue?.() !== false
      ) {
        setTransportIdle()
      }
    },
    [
      applyReconnectReplaySelection,
      fetchStreamBatch,
      seedStreamBatchPreviewSessions,
      attachToExistingStream,
      setTransportIdle,
    ]
  )

  const retryReconnect = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      gen: number
      targetChatId?: string
      shouldContinue?: () => boolean
    }): Promise<boolean> => {
      const { streamId, assistantId, gen, targetChatId, shouldContinue } = opts

      const isStaleReconnect = () =>
        streamGenRef.current !== gen ||
        abortControllerRef.current?.signal.aborted === true ||
        shouldContinue?.() === false

      for (let attempt = 0; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (isStaleReconnect()) return true

        if (attempt > 0) {
          const delayMs = Math.min(
            RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
            RECONNECT_MAX_DELAY_MS
          )
          logger.warn('Reconnect attempt', {
            streamId,
            attempt,
            maxAttempts: MAX_RECONNECT_ATTEMPTS,
            delayMs,
          })

          if (isStaleReconnect()) return true

          setTransportReconnecting()
          try {
            await sleepWithAbort(delayMs, abortControllerRef.current?.signal)
          } catch (err) {
            if (!(err instanceof Error) || err.name !== 'AbortError') {
              throw err
            }
          }
          if (isStaleReconnect()) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
        }

        try {
          await resumeOrFinalize({
            streamId,
            assistantId,
            gen,
            afterCursor: lastCursorRef.current || '0',
            signal: abortControllerRef.current?.signal,
            ...(targetChatId ? { targetChatId } : {}),
            ...(shouldContinue ? { shouldContinue } : {}),
          })
          if (streamGenRef.current !== gen) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (abortControllerRef.current?.signal.aborted) {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (!sendingRef.current) {
            setTransportIdle()
            return true
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            if (!sendingRef.current) {
              setTransportIdle()
            } else {
              setIsReconnecting(false)
            }
            return true
          }
          if (isStreamSchemaValidationError(err)) {
            logger.error('Reconnect halted by client-side stream schema enforcement', {
              streamId,
              attempt: attempt + 1,
              error: err.message,
            })
            if (streamGenRef.current === gen) {
              setError(err.message)
            }
            return false
          }
          logger.warn('Reconnect attempt failed', {
            streamId,
            attempt: attempt + 1,
            error: toError(err).message,
          })
        }
      }

      logger.error('All reconnect attempts exhausted', {
        streamId,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })
      if (streamGenRef.current === gen) {
        setIsReconnecting(false)
      }
      return false
    },
    [resumeOrFinalize, setTransportIdle, setTransportReconnecting]
  )
  retryReconnectRef.current = retryReconnect

  const recoverActiveStreamFromRedis = useCallback(
    async (reason: 'pageshow' | 'visible' | 'online'): Promise<void> => {
      const startingChatId = chatIdRef.current
      const startingSelectedChatId = selectedChatIdRef.current
      const chatId = startingChatId ?? startingSelectedChatId
      if (!chatId) return

      const subjectKey = buildRecoverySubjectKey(startingChatId, startingSelectedChatId)
      const existingRecovery = activeStreamReturnRecoveryRef.current
      if (existingRecovery?.subjectKey === subjectKey) {
        return existingRecovery.promise
      }
      if (existingRecovery) {
        existingRecovery.controller.abort('replaced_by_new_recovery_subject')
        activeStreamReturnRecoveryRef.current = null
      }

      const recoveryController = new AbortController()
      const recovery = (async () => {
        const observedGeneration = streamGenRef.current
        const isSameRecoverySubject = () =>
          chatIdRef.current === startingChatId &&
          selectedChatIdRef.current === startingSelectedChatId &&
          !recoveryController.signal.aborted

        const cached = queryClient.getQueryData<MothershipChatHistory>(
          mothershipChatKeys.detail(chatId)
        )
        const fallbackStreamId =
          streamIdRef.current ?? activeTurnRef.current?.userMessageId ?? cached?.activeStreamId
        const loadedStream = await getActiveStreamIdForChat(chatId, recoveryController.signal)
        const streamId = loadedStream.loaded
          ? (loadedStream.streamId ?? undefined)
          : fallbackStreamId
        if (
          !isSameRecoverySubject() ||
          streamGenRef.current !== observedGeneration ||
          pendingStopPromiseRef.current !== null ||
          !streamId ||
          locallyTerminalStreamIdRef.current === streamId
        ) {
          return
        }

        const recoveryGen = observedGeneration + 1
        const previousStreamId = streamIdRef.current ?? activeTurnRef.current?.userMessageId
        const afterCursor = previousStreamId === streamId ? lastCursorRef.current || '0' : '0'
        streamGenRef.current = recoveryGen
        setTransportReconnecting()
        streamIdRef.current = streamId

        const replacedController = abortControllerRef.current
        if (replacedController && !replacedController.signal.aborted) {
          replacedController.abort('superseded_recovery')
        }

        const replacedReader = streamReaderRef.current
        streamReaderRef.current = null
        void replacedReader?.cancel().catch((error) => {
          logger.warn('Failed to cancel superseded stream reader during recovery', {
            chatId,
            streamId,
            error: toError(error).message,
          })
        })

        abortControllerRef.current = recoveryController

        logger.info('Recovering active stream after browser return', {
          reason,
          chatId,
          streamId,
          fromGeneration: observedGeneration,
          toGeneration: recoveryGen,
        })

        if (
          streamGenRef.current !== recoveryGen ||
          pendingStopPromiseRef.current !== null ||
          !isSameRecoverySubject()
        ) {
          return
        }
        if (locallyTerminalStreamIdRef.current === streamId) return

        const assistantId = getLiveAssistantMessageId(streamId)

        try {
          await resumeOrFinalize({
            streamId,
            assistantId,
            gen: recoveryGen,
            afterCursor,
            signal: recoveryController.signal,
            targetChatId: chatId,
            shouldContinue: isSameRecoverySubject,
          })
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return
          }
          logger.warn('Active stream recovery failed', {
            reason,
            chatId,
            streamId,
            error: toError(error).message,
          })

          const succeeded = await retryReconnectRef.current({
            streamId,
            assistantId,
            gen: recoveryGen,
            targetChatId: chatId,
            shouldContinue: isSameRecoverySubject,
          })
          if (!succeeded && streamGenRef.current === recoveryGen && isSameRecoverySubject()) {
            finalizeRef.current({ error: true, targetChatId: chatId })
          }
        }
      })()

      activeStreamReturnRecoveryRef.current = {
        subjectKey,
        controller: recoveryController,
        promise: recovery,
      }
      try {
        await recovery
      } finally {
        if (activeStreamReturnRecoveryRef.current?.promise === recovery) {
          activeStreamReturnRecoveryRef.current = null
        }
      }
    },
    [getActiveStreamIdForChat, queryClient, resumeOrFinalize, setTransportReconnecting]
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const recoverIfChatSelected = (reason: 'pageshow' | 'visible' | 'online') => {
      if (!chatIdRef.current && !selectedChatIdRef.current) return
      void recoverActiveStreamFromRedis(reason)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverIfChatSelected('visible')
      }
    }

    const handlePageShow = () => {
      recoverIfChatSelected('pageshow')
    }

    const handleOnline = () => {
      recoverIfChatSelected('online')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('online', handleOnline)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('online', handleOnline)
    }
  }, [recoverActiveStreamFromRedis])

  const persistPartialResponse = useCallback(
    async (overrides?: {
      chatId?: string
      streamId?: string
      content?: string
      blocks?: ContentBlock[]
      // `stopGeneration` must snapshot these BEFORE clearActiveTurn()
      // nulls the refs, or the fetch sees undefined.
      requestId?: string
      traceparent?: string
    }) => {
      const chatId = overrides?.chatId ?? chatIdRef.current
      const streamId = overrides?.streamId ?? streamIdRef.current
      if (!chatId || !streamId) return

      const content = overrides?.content ?? streamingContentRef.current
      const requestId = overrides?.requestId ?? streamRequestIdRef.current
      const traceparent = overrides?.traceparent ?? streamTraceparentRef.current

      const sourceBlocks = overrides?.blocks ?? streamingBlocksRef.current
      const storedBlocks = sourceBlocks.map((block) => {
        const timing = {
          ...(typeof block.timestamp === 'number' ? { timestamp: block.timestamp } : {}),
          ...(typeof block.endedAt === 'number' ? { endedAt: block.endedAt } : {}),
        }
        if (block.type === 'tool_call' && block.toolCall) {
          const isCancelled =
            block.toolCall.status === 'executing' || block.toolCall.status === 'cancelled'
          const displayTitle = isCancelled ? 'Stopped by user' : block.toolCall.displayTitle
          const display = displayTitle ? { title: displayTitle } : undefined
          return {
            type: block.type,
            content: block.content,
            toolCall: {
              id: block.toolCall.id,
              name: block.toolCall.name,
              state: isCancelled ? MothershipStreamV1ToolOutcome.cancelled : block.toolCall.status,
              params: block.toolCall.params,
              result: block.toolCall.result,
              ...(display ? { display } : {}),
              calledBy: block.toolCall.calledBy,
            },
            ...(block.parentToolCallId ? { parentToolCallId: block.parentToolCallId } : {}),
            ...timing,
          }
        }
        return {
          type: block.type,
          content: block.content,
          ...(block.subagent ? { lane: 'subagent' } : {}),
          ...(block.parentToolCallId ? { parentToolCallId: block.parentToolCallId } : {}),
          ...timing,
        }
      })

      if (storedBlocks.length > 0) {
        storedBlocks.push({ type: 'stopped', content: undefined })
      }

      try {
        const res = await fetch(stopPathRef.current, {
          method: 'POST',
          signal: createTimeoutSignal(STOP_REQUEST_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/json',
            ...(traceparent ? { traceparent } : {}),
          },
          body: JSON.stringify({
            chatId,
            streamId,
            content,
            ...(storedBlocks.length > 0 && { contentBlocks: storedBlocks }),
            ...(requestId ? { requestId } : {}),
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          throw new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Failed to persist partial response'
          )
        }
        if (!overrides || streamIdRef.current === streamId) {
          streamingContentRef.current = ''
          streamingBlocksRef.current = []
        }
      } catch (err) {
        logger.warn('Failed to persist partial response', err)
        throw err instanceof Error ? err : new Error('Failed to persist partial response')
      }
    },
    []
  )

  const invalidateChatQueries = useCallback(
    (options?: { includeDetail?: boolean; targetChatId?: string }) => {
      const activeChatId = options?.targetChatId ?? chatIdRef.current
      if (options?.includeDetail !== false && activeChatId) {
        queryClient.invalidateQueries({
          queryKey: mothershipChatKeys.detail(activeChatId),
        })
      }
      queryClient.invalidateQueries({ queryKey: mothershipChatKeys.list(workspaceId) })
    },
    [workspaceId, queryClient]
  )

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  /**
   * Notify downstream consumers that a turn has ended and, if a
   * follow-up message is queued, kick the dispatcher. Safe to call
   * from both the normal-completion path (`finalize`) and the
   * abort/stop path (`stopGeneration`), which previously short-
   * circuited without notifying — queued messages then sat until the
   * user manually re-sent. Idempotent w.r.t. `onStreamEnd` (one call
   * per terminal transition); the dispatcher itself de-dupes.
   */
  const notifyTurnEnded = useCallback(
    (options: { error: boolean; skipQueueDispatch?: boolean }) => {
      const queue = useMothershipQueueStore.getState().queues[chatKeyRef.current]
      const hasQueuedFollowUp = !options.error && (queue?.length ?? 0) > 0
      if (!options.error) {
        const cid = chatIdRef.current
        if (cid && onStreamEndRef.current) {
          onStreamEndRef.current(cid, messagesRef.current)
        }
      }
      if (!options.error && !options.skipQueueDispatch && hasQueuedFollowUp) {
        void enqueueQueueDispatchRef.current({ type: 'send_head' })
      }
      return hasQueuedFollowUp
    },
    []
  )

  const createQueuedMessage = useCallback(
    (
      message: string,
      fileAttachments?: FileAttachmentForApi[],
      contexts?: ChatContext[]
    ): QueuedMothershipMessage => {
      const id = generateId()
      const handoffChatId = selectedChatIdRef.current ?? chatIdRef.current
      const cachedActiveStreamId = handoffChatId
        ? queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(handoffChatId))
            ?.activeStreamId
        : undefined
      const supersededStreamId =
        streamIdRef.current ||
        activeTurnRef.current?.userMessageId ||
        locallyTerminalStreamIdRef.current ||
        cachedActiveStreamId ||
        null

      return {
        id,
        content: message,
        fileAttachments,
        contexts,
        ...(supersededStreamId || handoffChatId
          ? {
              queuedSendHandoff: {
                id,
                ...(handoffChatId ? { chatId: handoffChatId } : {}),
                supersededStreamId,
              },
            }
          : {}),
      }
    },
    [queryClient]
  )

  const finalize = useCallback(
    (options?: { error?: boolean; targetChatId?: string }) => {
      const isError = !!options?.error
      if (isError) {
        const blocks = streamingBlocksRef.current
        if (blocks.some((block) => block.toolCall?.status === 'executing')) {
          finalizeResidualToolCalls(blocks, 'error')
          const assistantId =
            activeTurnRef.current?.assistantMessageId ??
            (streamIdRef.current ? getLiveAssistantMessageId(streamIdRef.current) : undefined)
          const activeChatId = options?.targetChatId ?? chatIdRef.current
          if (assistantId && activeChatId) {
            const snapshot = buildAssistantSnapshotMessage({
              id: assistantId,
              content: streamingContentRef.current,
              contentBlocks: blocks,
              ...(streamRequestIdRef.current ? { requestId: streamRequestIdRef.current } : {}),
            })
            upsertChatHistory(activeChatId, (current) => ({
              ...current,
              messages: current.messages.map((message) =>
                message.id === assistantId ? snapshot : message
              ),
            }))
          } else if (assistantId) {
            setPendingMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, contentBlocks: [...blocks] } : message
              )
            )
          }
        }
      }
      const queue = useMothershipQueueStore.getState().queues[chatKeyRef.current]
      const hasQueuedFollowUp = !isError && (queue?.length ?? 0) > 0
      reconcileTerminalPreviewSessions()
      locallyTerminalStreamIdRef.current =
        streamIdRef.current ?? activeTurnRef.current?.userMessageId ?? undefined
      clearActiveTurn()
      setTransportIdle()
      abortControllerRef.current = null
      invalidateChatQueries({
        includeDetail: !hasQueuedFollowUp,
        ...(options?.targetChatId ? { targetChatId: options.targetChatId } : {}),
      })
      notifyTurnEnded({ error: isError })
    },
    [
      clearActiveTurn,
      invalidateChatQueries,
      notifyTurnEnded,
      reconcileTerminalPreviewSessions,
      setTransportIdle,
      upsertChatHistory,
    ]
  )
  finalizeRef.current = finalize

  const startSendMessage = useCallback(
    async (
      message: string,
      fileAttachments?: FileAttachmentForApi[],
      contexts?: ChatContext[],
      pendingStopOverride?: Promise<void> | null,
      onOptimisticSendApplied?: () => void,
      queuedSendHandoff?: QueuedSendHandoffSeed
    ) => {
      if (!message.trim() || !workspaceId) return false
      const pendingStop = pendingStopOverride ?? pendingStopPromiseRef.current
      const pendingStopStreamId = pendingStop
        ? queuedSendHandoff?.supersededStreamId ||
          locallyTerminalStreamIdRef.current ||
          streamIdRef.current ||
          activeTurnRef.current?.userMessageId
        : undefined

      let consumedByTranscript = false

      setError(null)
      setTransportStreaming()

      const userMessageId = queuedSendHandoff?.userMessageId ?? generateId()
      const assistantId = getLiveAssistantMessageId(userMessageId)

      const storedAttachments: PersistedFileAttachment[] | undefined =
        fileAttachments && fileAttachments.length > 0
          ? fileAttachments.map((f) => ({
              id: f.id,
              key: f.key,
              filename: f.filename,
              media_type: f.media_type,
              size: f.size,
            }))
          : undefined

      let requestChatId =
        queuedSendHandoff?.chatId ?? selectedChatIdRef.current ?? chatIdRef.current
      const writeQueuedSendHandoff = (chatId?: string) => {
        if (!queuedSendHandoff) return
        if (!chatId && !queuedSendHandoff.supersededStreamId) return
        writeQueuedSendHandoffState({
          id: queuedSendHandoff.id,
          ...(chatId ? { chatId } : {}),
          workspaceId,
          supersededStreamId: queuedSendHandoff.supersededStreamId,
          userMessageId,
          message,
          ...(fileAttachments ? { fileAttachments } : {}),
          ...(contexts ? { contexts } : {}),
          requestedAt: Date.now(),
        })
      }
      if (queuedSendHandoff) {
        writeQueuedSendHandoff(queuedSendHandoff.chatId)
      }
      const messageContexts = contexts?.map((c) => ({
        kind: c.kind,
        label: c.label,
        ...('workflowId' in c && c.workflowId ? { workflowId: c.workflowId } : {}),
        ...('knowledgeId' in c && c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}),
        ...('tableId' in c && c.tableId ? { tableId: c.tableId } : {}),
        ...('fileId' in c && c.fileId ? { fileId: c.fileId } : {}),
        ...('folderId' in c && c.folderId ? { folderId: c.folderId } : {}),
        ...(c.kind === 'skill' && 'skillId' in c ? { skillId: c.skillId } : {}),
        ...(c.kind === 'integration' && 'blockType' in c ? { blockType: c.blockType } : {}),
      }))
      const cachedUserMsg: PersistedMessage = {
        id: userMessageId,
        role: 'user' as const,
        content: message,
        timestamp: new Date().toISOString(),
        ...(storedAttachments && { fileAttachments: storedAttachments }),
        ...(messageContexts && messageContexts.length > 0 ? { contexts: messageContexts } : {}),
      }
      pendingUserMsgRef.current = cachedUserMsg

      const userAttachments = storedAttachments?.map((f) => ({
        id: f.id,
        filename: f.filename,
        media_type: f.media_type,
        size: f.size,
        previewUrl: getMothershipAttachmentPreviewUrl(f),
      }))

      const optimisticUserMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: message,
        attachments: userAttachments,
        ...(messageContexts && messageContexts.length > 0 ? { contexts: messageContexts } : {}),
      }
      const optimisticAssistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        contentBlocks: [],
      }

      if (requestChatId) {
        await queryClient.cancelQueries({ queryKey: mothershipChatKeys.detail(requestChatId) })
      }

      const applyOptimisticSend = () => {
        const assistantSnapshot = buildAssistantSnapshotMessage({
          id: assistantId,
          content: '',
          contentBlocks: [],
        })
        if (requestChatId) {
          upsertChatHistory(requestChatId, (current) => ({
            ...current,
            resources: current.resources.filter((resource) => resource.id !== 'streaming-file'),
            messages: [
              ...current.messages.filter(
                (persistedMessage) =>
                  persistedMessage.id !== userMessageId && persistedMessage.id !== assistantId
              ),
              cachedUserMsg,
              assistantSnapshot,
            ],
            activeStreamId: userMessageId,
          }))
        }

        setPendingMessages((prev) => {
          const nextMessages = prev.filter((m) => m.id !== userMessageId && m.id !== assistantId)
          return [...nextMessages, optimisticUserMessage, optimisticAssistantMessage]
        })
      }

      const rollbackOptimisticSend = () => {
        if (requestChatId) {
          upsertChatHistory(requestChatId, (current) => ({
            ...current,
            messages: current.messages.filter(
              (persistedMessage) =>
                persistedMessage.id !== userMessageId && persistedMessage.id !== assistantId
            ),
            activeStreamId:
              current.activeStreamId === userMessageId ? null : current.activeStreamId,
          }))
        }

        setPendingMessages((prev) =>
          prev.filter(
            (pendingMessage) =>
              pendingMessage.id !== userMessageId && pendingMessage.id !== assistantId
          )
        )
      }

      applyOptimisticSend()
      onOptimisticSendApplied?.()
      consumedByTranscript = true

      let gen: number | undefined
      let streamTargetChatId: string | undefined
      try {
        if (pendingStop) {
          try {
            await pendingStop
            if (!requestChatId) {
              requestChatId =
                queuedSendHandoff?.chatId ??
                (queuedSendHandoff ? undefined : selectedChatIdRef.current) ??
                chatIdRef.current
              if (!requestChatId && pendingStopStreamId) {
                const resolvedChatId = await resolveChatIdForStream(pendingStopStreamId, {
                  preferExistingChatId: false,
                })
                if (resolvedChatId) {
                  if (!selectedChatIdRef.current || selectedChatIdRef.current === resolvedChatId) {
                    adoptResolvedChatId(resolvedChatId, { replaceHomeHistory: true })
                  }
                  requestChatId = resolvedChatId
                }
              }
              if (requestChatId) {
                writeQueuedSendHandoff(requestChatId)
              }
            }
            if ((queuedSendHandoff || pendingStopStreamId) && !requestChatId) {
              throw new Error('Cannot send queued message until the active chat is known.')
            }
            if (
              queuedSendHandoff &&
              requestChatId &&
              selectedChatIdRef.current &&
              selectedChatIdRef.current !== requestChatId
            ) {
              throw new Error('Queued message was restored because the selected chat changed.')
            }
            if (requestChatId) {
              await queryClient.cancelQueries({
                queryKey: mothershipChatKeys.detail(requestChatId),
              })
            }
            applyOptimisticSend()
          } catch (err) {
            if (queuedSendHandoff) {
              clearQueuedSendHandoffClaim(queuedSendHandoff.id)
            }
            rollbackOptimisticSend()
            if (!streamReaderRef.current && !abortControllerRef.current) {
              clearActiveTurn()
              setTransportIdle()
            }
            setError(getErrorMessage(err, 'Failed to stop the previous response'))
            return false
          }
        }

        streamTargetChatId = requestChatId
        gen = ++streamGenRef.current
        locallyTerminalStreamIdRef.current = undefined
        streamIdRef.current = userMessageId
        lastCursorRef.current = '0'
        resetStreamingBuffers()
        activeTurnRef.current = {
          userMessageId,
          assistantMessageId: assistantId,
          optimisticUserMessage,
          optimisticAssistantMessage,
        }
        const abortController = new AbortController()
        abortControllerRef.current = abortController

        const currentActiveId = activeResourceIdRef.current
        // The live browser panel's page state is client-held (the desktop
        // app's embedded browser): its attachment carries the current URL and
        // title so the server can inject them as @open_tab/@active_tab
        // context. With no page loaded there is nothing to say — drop it.
        const browserPageState = useBrowserSessionStore.getState().pageState
        const currentResources = resourcesRef.current.filter(
          (r) => r.type !== 'browser' || Boolean(browserPageState?.url)
        )
        const resourceAttachments =
          currentResources.length > 0
            ? currentResources.map((r) => ({
                type: r.type,
                id: r.id,
                title: r.type === 'browser' ? browserPageState?.title?.trim() || r.title : r.title,
                active: r.id === currentActiveId,
                ...(r.type === 'browser' ? { url: browserPageState?.url } : {}),
              }))
            : undefined

        const response = await fetch(apiPathRef.current, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            workspaceId,
            userMessageId,
            createNewChat: !requestChatId,
            ...(requestChatId ? { chatId: requestChatId } : {}),
            ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
            ...(resourceAttachments ? { resourceAttachments } : {}),
            ...(contexts && contexts.length > 0 ? { contexts } : {}),
            ...(workflowIdRef.current ? { workflowId: workflowIdRef.current } : {}),
            ...(typeof window !== 'undefined' && window.simDesktop?.localFilesystem
              ? { desktopCapabilities: { localFilesystem: true } }
              : {}),
            // Advertised only when the desktop app's browser-agent bridge is
            // present — gates the browser subagent server-side.
            ...(isBrowserAgentAvailable() ? { browserCapable: true } : {}),
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: abortController.signal,
        })

        // Capture for propagation on side-channel calls + non-React
        // tool-completion callbacks (via trace-context singleton).
        const traceparent = response.headers.get('traceparent')
        if (traceparent) {
          streamTraceparentRef.current = traceparent
          setCurrentChatTraceparent(traceparent)
          const traceId = traceparent.split('-')[1] ?? ''
          if (/^[0-9a-f]{32}$/.test(traceId)) {
            try {
              onRequestStartedRef.current?.({ requestId: traceId, userMessageId })
            } catch (callbackError) {
              logger.warn('onRequestStarted callback threw', { error: callbackError })
            }
          }
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          if (response.status === 409) {
            const conflictStreamId =
              typeof errorData.activeStreamId === 'string'
                ? errorData.activeStreamId
                : userMessageId
            const supersededStreamId = queuedSendHandoff?.supersededStreamId ?? pendingStopStreamId
            if (supersededStreamId && conflictStreamId === supersededStreamId) {
              rollbackOptimisticSend()
              if (streamGenRef.current === gen) {
                streamGenRef.current++
                abortController.abort('queued_handoff:superseded_conflict')
                abortControllerRef.current = null
                clearActiveTurn()
                setTransportIdle()
              }
              setError('Previous response is still shutting down; queued message was restored.')
              return false
            }
            streamIdRef.current = conflictStreamId
            const succeeded = await retryReconnect({
              streamId: conflictStreamId,
              assistantId,
              gen,
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
            if (succeeded) return consumedByTranscript
            if (streamGenRef.current === gen) {
              finalize({
                error: true,
                ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
              })
            }
            return consumedByTranscript
          }
          throw new Error(errorData.error || `Request failed: ${response.status}`)
        }

        if (queuedSendHandoff) {
          clearQueuedSendHandoffState(queuedSendHandoff.id)
        }

        if (!response.body) throw new Error('No response body')

        const streamResult = await processSSEStream(response.body.getReader(), assistantId, gen, {
          ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
        })
        if (streamGenRef.current === gen) {
          if (streamResult.sawStreamError) {
            finalize({
              error: true,
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
            return consumedByTranscript
          }

          // A live SSE `complete` event is already terminal. Finalize immediately so follow-up
          // sends do not get spuriously queued behind an already-finished response.
          if (streamResult.sawComplete) {
            finalize({
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
            return consumedByTranscript
          }

          await resumeOrFinalize({
            streamId: streamIdRef.current || userMessageId,
            assistantId,
            gen,
            afterCursor: lastCursorRef.current || '0',
            signal: abortController.signal,
            ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
          })
          if (streamGenRef.current === gen && sendingRef.current) {
            finalize({
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return consumedByTranscript
        if (isStreamSchemaValidationError(err)) {
          setError(err.message)
          if (gen !== undefined && streamGenRef.current === gen) {
            finalize({
              error: true,
              ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
            })
          }
          return consumedByTranscript
        }

        const activeStreamId = streamIdRef.current
        if (activeStreamId && gen !== undefined && streamGenRef.current === gen) {
          const succeeded = await retryReconnect({
            streamId: activeStreamId,
            assistantId,
            gen,
            ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
          })
          if (succeeded) return consumedByTranscript
        }

        setError(getErrorMessage(err, 'Failed to send message'))
        if (gen !== undefined && streamGenRef.current === gen) {
          finalize({
            error: true,
            ...(streamTargetChatId ? { targetChatId: streamTargetChatId } : {}),
          })
        }
        return consumedByTranscript
      }
      return consumedByTranscript
    },
    [
      workspaceId,
      queryClient,
      upsertChatHistory,
      processSSEStream,
      finalize,
      resumeOrFinalize,
      retryReconnect,
      clearActiveTurn,
      resetStreamingBuffers,
      resolveChatIdForStream,
      adoptResolvedChatId,
      setTransportIdle,
      setTransportStreaming,
    ]
  )
  const sendMessage = useCallback(
    async (message: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      if (!message.trim() || !workspaceId) return

      const queueStore = useMothershipQueueStore.getState()
      const activeChatKey = chatKeyRef.current
      const editingId = queueStore.editing[activeChatKey] ?? null

      // Edit-in-place: replace at the original index. If the slot was already
      // dispatched mid-edit (UI-guard race), fall through to a tail-append.
      if (editingId) {
        const existing = queueStore.queues[activeChatKey] ?? []
        if (existing.some((m) => m.id === editingId)) {
          queueStore.replaceAt(activeChatKey, editingId, {
            content: message,
            fileAttachments,
            contexts,
          })
          queueStore.setEditing(activeChatKey, null)
          // Resume dispatch if it paused on this slot.
          if (!sendingRef.current && !pendingStopPromiseRef.current) {
            void enqueueQueueDispatchRef.current({ type: 'send_head' })
          }
          return
        }
        queueStore.setEditing(activeChatKey, null)
      }

      if (sendingRef.current) {
        queueStore.enqueue(activeChatKey, createQueuedMessage(message, fileAttachments, contexts))
        return
      }

      if (pendingStopPromiseRef.current) {
        queueStore.enqueue(activeChatKey, createQueuedMessage(message, fileAttachments, contexts))
        void enqueueQueueDispatchRef.current({ type: 'send_head' })
        return
      }

      await startSendMessage(message, fileAttachments, contexts)
    },
    [workspaceId, startSendMessage, createQueuedMessage]
  )
  useEffect(() => {
    if (typeof window === 'undefined') return

    const clearClaim = () => {
      clearQueuedSendHandoffClaim()
    }

    window.addEventListener('pagehide', clearClaim)
    window.addEventListener('beforeunload', clearClaim)
    return () => {
      window.removeEventListener('pagehide', clearClaim)
      window.removeEventListener('beforeunload', clearClaim)
    }
  }, [])
  useEffect(() => {
    if (!workspaceId || sendingRef.current || pendingStopPromiseRef.current) return

    let cancelled = false
    const handoff = readQueuedSendHandoffState()
    if (!handoff || handoff.workspaceId !== workspaceId) return
    if (recoveringQueuedSendHandoffRef.current?.id === handoff.id) return
    const claimRetryDelayMs = queuedSendHandoffClaimRetryDelay(handoff.id)
    if (claimRetryDelayMs !== null) {
      const retryTimer = window.setTimeout(() => {
        setQueuedHandoffRecoveryEpoch((epoch) => epoch + 1)
      }, claimRetryDelayMs)
      return () => window.clearTimeout(retryTimer)
    }

    if (handoff.chatId) {
      if (selectedChatIdRef.current && selectedChatIdRef.current !== handoff.chatId) return
      adoptResolvedChatId(handoff.chatId, { replaceHomeHistory: true })
      return
    }

    if (!handoff.supersededStreamId) return

    const claimOwnerId = writeQueuedSendHandoffClaim(handoff.id)
    recoveringQueuedSendHandoffRef.current = { id: handoff.id, ownerId: claimOwnerId }
    const effectAbortController = new AbortController()
    let shouldRetry = false
    void (async () => {
      const chatId = await resolveChatIdForStream(handoff.supersededStreamId as string, {
        preferExistingChatId: false,
        signal: effectAbortController.signal,
      })
      if (!chatId) {
        shouldRetry = true
        return
      }
      if (cancelled) return
      const currentHandoff = readQueuedSendHandoffState()
      if (
        !currentHandoff ||
        currentHandoff.id !== handoff.id ||
        currentHandoff.workspaceId !== workspaceId ||
        currentHandoff.userMessageId !== handoff.userMessageId ||
        currentHandoff.supersededStreamId !== handoff.supersededStreamId ||
        currentHandoff.chatId ||
        !hasQueuedSendHandoffClaimOwner(handoff.id, claimOwnerId)
      ) {
        return
      }
      writeQueuedSendHandoffState({
        ...currentHandoff,
        chatId,
        requestedAt: Date.now(),
      })
      setQueuedHandoffRecoveryEpoch((epoch) => epoch + 1)
      if (!selectedChatIdRef.current || selectedChatIdRef.current === chatId) {
        adoptResolvedChatId(chatId, { replaceHomeHistory: true, invalidateList: true })
      }
    })()
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
        logger.warn('Failed to resolve queued send handoff chat id', {
          handoffId: handoff.id,
          streamId: handoff.supersededStreamId,
          error: toError(error).message,
        })
      })
      .finally(async () => {
        if (
          shouldRetry &&
          !cancelled &&
          recoveringQueuedSendHandoffRef.current?.id === handoff.id &&
          recoveringQueuedSendHandoffRef.current.ownerId === claimOwnerId
        ) {
          const currentHandoff = readQueuedSendHandoffState()
          if (currentHandoff?.id === handoff.id && !currentHandoff.chatId) {
            const resolveAttempts = (currentHandoff.resolveAttempts ?? 0) + 1
            writeQueuedSendHandoffState({ ...currentHandoff, resolveAttempts })
            try {
              await sleepWithAbort(
                queuedSendHandoffResolveRetryDelay(resolveAttempts),
                effectAbortController.signal
              )
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') return
              logger.warn('Failed to back off queued send handoff recovery', {
                handoffId: handoff.id,
                error: toError(error).message,
              })
              return
            }
            if (
              !cancelled &&
              recoveringQueuedSendHandoffRef.current?.id === handoff.id &&
              recoveringQueuedSendHandoffRef.current.ownerId === claimOwnerId
            ) {
              recoveringQueuedSendHandoffRef.current = null
              clearQueuedSendHandoffClaim(handoff.id, claimOwnerId)
              setQueuedHandoffRecoveryEpoch((epoch) => epoch + 1)
            }
            return
          }
        }
        if (
          recoveringQueuedSendHandoffRef.current?.id === handoff.id &&
          recoveringQueuedSendHandoffRef.current.ownerId === claimOwnerId
        ) {
          recoveringQueuedSendHandoffRef.current = null
        }
        clearQueuedSendHandoffClaim(handoff.id, claimOwnerId)
      })
    return () => {
      cancelled = true
      effectAbortController.abort('cleanup:queued_handoff_recovery')
      if (
        recoveringQueuedSendHandoffRef.current?.id === handoff.id &&
        recoveringQueuedSendHandoffRef.current.ownerId === claimOwnerId
      ) {
        recoveringQueuedSendHandoffRef.current = null
      }
      clearQueuedSendHandoffClaim(handoff.id, claimOwnerId)
    }
  }, [workspaceId, queuedHandoffRecoveryEpoch, adoptResolvedChatId, resolveChatIdForStream])
  useEffect(() => {
    if (!workspaceId || !chatHistory || sendingRef.current || pendingStopPromiseRef.current) return

    const handoff = readQueuedSendHandoffState()
    if (!handoff) return
    if (handoff.workspaceId !== workspaceId || handoff.chatId !== chatHistory.id) return
    if (recoveringQueuedSendHandoffRef.current?.id === handoff.id) return
    if (readQueuedSendHandoffClaim() === handoff.id) return

    if (
      chatHistory.activeStreamId === handoff.userMessageId ||
      chatHistory.messages.some((message) => message.id === handoff.userMessageId)
    ) {
      clearQueuedSendHandoffState(handoff.id)
      clearQueuedSendHandoffClaim(handoff.id)
      return
    }

    if (chatHistory.activeStreamId === handoff.supersededStreamId) {
      return
    }

    if (chatHistory.activeStreamId && chatHistory.activeStreamId !== handoff.supersededStreamId) {
      clearQueuedSendHandoffState(handoff.id)
      clearQueuedSendHandoffClaim(handoff.id)
      return
    }

    const claimOwnerId = writeQueuedSendHandoffClaim(handoff.id)
    recoveringQueuedSendHandoffRef.current = { id: handoff.id, ownerId: claimOwnerId }
    void startSendMessage(
      handoff.message,
      handoff.fileAttachments,
      handoff.contexts,
      null,
      undefined,
      {
        id: handoff.id,
        chatId: handoff.chatId,
        supersededStreamId: handoff.supersededStreamId,
        userMessageId: handoff.userMessageId,
      }
    ).finally(() => {
      if (
        recoveringQueuedSendHandoffRef.current?.id === handoff.id &&
        recoveringQueuedSendHandoffRef.current.ownerId === claimOwnerId
      ) {
        recoveringQueuedSendHandoffRef.current = null
      }
      clearQueuedSendHandoffClaim(handoff.id, claimOwnerId)
    })
  }, [workspaceId, chatHistory, queuedHandoffRecoveryEpoch, startSendMessage])
  const cancelActiveWorkflowExecutions = useCallback(() => {
    const execState = useExecutionStore.getState()
    const consoleStore = useTerminalConsoleStore.getState()

    for (const [workflowId, wfExec] of execState.workflowExecutions) {
      if (!wfExec.isExecuting) continue

      const toolCallId = markRunToolManuallyStopped(workflowId)
      cancelRunToolExecution(workflowId)

      const executionId = execState.getCurrentExecutionId(workflowId)
      if (executionId) {
        execState.setCurrentExecutionId(workflowId, null)
        requestJson(cancelWorkflowExecutionContract, {
          params: { id: workflowId, executionId },
        }).catch(() => {})
      }

      consoleStore.cancelRunningEntries(workflowId, executionId ?? undefined)
      const now = new Date()
      consoleStore.addConsole({
        input: {},
        output: {},
        success: false,
        error: 'Run was cancelled',
        durationMs: 0,
        startedAt: now.toISOString(),
        executionOrder: Number.MAX_SAFE_INTEGER,
        endedAt: now.toISOString(),
        workflowId,
        blockId: 'cancelled',
        executionId: executionId ?? undefined,
        blockName: 'Run Cancelled',
        blockType: 'cancelled',
      })

      executionStream.cancel(workflowId)
      execState.setIsExecuting(workflowId, false)
      execState.setIsDebugging(workflowId, false)
      execState.setActiveBlocks(workflowId, new Set())

      reportManualRunToolStop(workflowId, toolCallId).catch(() => {})
    }
  }, [executionStream])

  const stopGeneration = useCallback(
    async (options?: StopGenerationOptions) => {
      const mode = options?.mode ?? 'normal'
      if (pendingStopPromiseRef.current) {
        if (mode === 'queued-handoff' && pendingStopModeRef.current !== 'queued-handoff') {
          throw new Error('Previous response is already stopping; queued message was restored.')
        }
        return pendingStopPromiseRef.current
      }

      let resolveStopOperation!: () => void
      let rejectStopOperation!: (error: unknown) => void
      const stopOperation = new Promise<void>((resolve, reject) => {
        resolveStopOperation = resolve
        rejectStopOperation = reject
      })
      stopOperation.catch(() => {})
      pendingStopPromiseRef.current = stopOperation
      pendingStopModeRef.current = mode

      const wasSending = sendingRef.current
      let activeChatId = chatIdRef.current ?? selectedChatIdRef.current
      const sid =
        streamIdRef.current ||
        activeTurnRef.current?.userMessageId ||
        (activeChatId
          ? queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(activeChatId))
              ?.activeStreamId
          : undefined) ||
        undefined

      const activeAssistantMessageId =
        activeTurnRef.current?.assistantMessageId ??
        (sid ? getLiveAssistantMessageId(sid) : undefined)
      const initialStopRequestIdSnapshot = streamRequestIdRef.current
      const initialStopTraceparentSnapshot = streamTraceparentRef.current

      try {
        if (mode === 'queued-handoff' && !activeChatId && !sid) {
          throw new Error('Cannot send queued message until the active chat is known.')
        }
      } catch (err) {
        if (pendingStopPromiseRef.current === stopOperation) {
          pendingStopPromiseRef.current = null
          pendingStopModeRef.current = null
        }
        setError(getErrorMessage(err, 'Failed to stop the previous response'))
        rejectStopOperation(err)
        throw err
      }

      const stopContentSnapshot = streamingContentRef.current
      const stopNow = Date.now()
      const stopBlocksSnapshot = streamingBlocksRef.current.map((block) => ({
        ...block,
        ...(block.options ? { options: [...block.options] } : {}),
        ...(block.toolCall ? { toolCall: { ...block.toolCall } } : {}),
        ...(block.endedAt === undefined ? { endedAt: stopNow } : {}),
      }))
      const stopRequestIdSnapshot = streamRequestIdRef.current ?? initialStopRequestIdSnapshot
      const stopTraceparentSnapshot = streamTraceparentRef.current ?? initialStopTraceparentSnapshot

      locallyTerminalStreamIdRef.current = sid
      streamGenRef.current++
      clearActiveTurn()
      streamReaderRef.current?.cancel().catch(() => {})
      streamReaderRef.current = null
      abortControllerRef.current?.abort('user_stop:client_stopGeneration')
      abortControllerRef.current = null
      setTransportIdle()

      try {
        if (activeChatId) {
          await queryClient.cancelQueries({ queryKey: mothershipChatKeys.detail(activeChatId) })
          upsertChatHistory(activeChatId, (current) => ({
            ...current,
            messages: current.messages.map((message) =>
              activeAssistantMessageId && message.id === activeAssistantMessageId
                ? markMessageStopped(message)
                : message
            ),
          }))
        } else {
          setPendingMessages((prev) =>
            prev.map((msg) => {
              const hasExecutingTool = msg.contentBlocks?.some(
                (block) => block.toolCall?.status === 'executing'
              )
              const hasOpenBlock = msg.contentBlocks?.some((block) => block.endedAt === undefined)
              if (!hasExecutingTool && !hasOpenBlock) {
                return msg
              }
              const updatedBlocks: ContentBlock[] = (msg.contentBlocks ?? []).map((block) => ({
                ...block,
                ...(block.endedAt === undefined ? { endedAt: stopNow } : {}),
                ...(block.toolCall ? { toolCall: { ...block.toolCall } } : {}),
              }))
              finalizeResidualToolCalls(updatedBlocks, 'cancelled')
              updatedBlocks.push({ type: 'stopped' as const })
              return { ...msg, contentBlocks: updatedBlocks }
            })
          )
        }
      } catch (err) {
        if (sid && locallyTerminalStreamIdRef.current === sid) {
          locallyTerminalStreamIdRef.current = undefined
        }
        if (pendingStopPromiseRef.current === stopOperation) {
          pendingStopPromiseRef.current = null
          pendingStopModeRef.current = null
        }
        setError(getErrorMessage(err, 'Failed to stop the previous response'))
        rejectStopOperation(err)
        throw err
      }

      // Cancel active run-tool executions before waiting for the server-side stream
      // shutdown barrier; otherwise the abort settle can sit behind tool execution teardown.
      cancelActiveWorkflowExecutions()

      let abortSucceeded = false
      const stopBarrier = (async () => {
        let stopSucceeded = false
        try {
          let resolvedChatId = activeChatId ?? chatIdRef.current
          let abortSettled = false
          const postAbortRequest = async (chatId?: string): Promise<boolean> => {
            if (!sid) return true
            // boundary-raw-fetch: stream-abort endpoint requires propagating the snapshotted traceparent header from the in-flight stream and has no contract authored yet
            const res = await fetch('/api/mothership/chat/abort', {
              method: 'POST',
              signal: createTimeoutSignal(STOP_REQUEST_TIMEOUT_MS),
              headers: {
                'Content-Type': 'application/json',
                ...(stopTraceparentSnapshot ? { traceparent: stopTraceparentSnapshot } : {}),
              },
              body: JSON.stringify({
                streamId: sid,
                ...(chatId ? { chatId } : {}),
              }),
            })
            const payload: unknown = await res.json().catch(() => null)
            if (isRecordLike(payload) && payload.aborted === true) {
              abortSucceeded = true
            }
            if (!res.ok) {
              if (isRecordLike(payload) && payload.settled === false) {
                return false
              }
              throw new Error(
                isRecordLike(payload) && typeof payload.error === 'string'
                  ? payload.error
                  : 'Failed to abort previous response'
              )
            }
            abortSucceeded = true
            return isRecordLike(payload) && payload.settled === true
          }
          const abortPromise = sid
            ? postAbortRequest(resolvedChatId).then((settled) => {
                abortSettled = settled
              })
            : Promise.resolve()

          let stopFailure: unknown
          let abortFailure: unknown
          try {
            if (mode === 'queued-handoff' && !resolvedChatId && sid) {
              resolvedChatId = await resolveChatIdForStream(sid, {
                preferExistingChatId: false,
              })
              if (!resolvedChatId) {
                throw new Error('Cannot send queued message until the active chat is known.')
              }
              if (
                pendingStopPromiseRef.current !== stopOperation ||
                locallyTerminalStreamIdRef.current !== sid
              ) {
                throw new Error(
                  'Previous response stop was superseded; queued message was restored.'
                )
              }
              activeChatId = resolvedChatId
              if (!selectedChatIdRef.current || selectedChatIdRef.current === resolvedChatId) {
                adoptResolvedChatId(resolvedChatId, { replaceHomeHistory: true })
              }
            }

            if (wasSending && resolvedChatId) {
              await persistPartialResponse({
                chatId: resolvedChatId,
                streamId: sid,
                content: stopContentSnapshot,
                blocks: stopBlocksSnapshot,
                requestId: stopRequestIdSnapshot,
                traceparent: stopTraceparentSnapshot,
              })
            }
          } catch (err) {
            stopFailure = err
          }

          try {
            await abortPromise
          } catch (err) {
            abortFailure = err
          }
          if (sid && resolvedChatId && !abortSettled) {
            try {
              const retrySettled = await postAbortRequest(resolvedChatId)
              abortSettled = retrySettled
              abortFailure = retrySettled
                ? undefined
                : new Error('Previous response is still shutting down.')
            } catch (err) {
              abortFailure = err
            }
          }

          if (stopFailure || abortFailure) throw stopFailure ?? abortFailure
          if (wasSending && resolvedChatId) {
            activeChatId = resolvedChatId
          }
          stopSucceeded = true
        } finally {
          invalidateChatQueries({
            includeDetail: mode !== 'queued-handoff' || !stopSucceeded,
          })
          resetEphemeralPreviewState({ removeStreamingResource: true })
        }
      })()

      try {
        await stopBarrier
        notifyTurnEnded({
          error: false,
          skipQueueDispatch: mode === 'queued-handoff',
        })
        resolveStopOperation()
      } catch (err) {
        if (sid && !abortSucceeded && locallyTerminalStreamIdRef.current === sid) {
          locallyTerminalStreamIdRef.current = undefined
        }
        if (activeChatId) {
          invalidateChatQueries()
        }
        setError(getErrorMessage(err, 'Failed to stop the previous response'))
        rejectStopOperation(err)
        throw err
      } finally {
        if (pendingStopPromiseRef.current === stopOperation) {
          pendingStopPromiseRef.current = null
          pendingStopModeRef.current = null
        }
      }
    },
    [
      cancelActiveWorkflowExecutions,
      invalidateChatQueries,
      notifyTurnEnded,
      persistPartialResponse,
      queryClient,
      resolveChatIdForStream,
      resetEphemeralPreviewState,
      upsertChatHistory,
      adoptResolvedChatId,
      clearActiveTurn,
      setTransportIdle,
      workspaceId,
    ]
  )

  const dispatchQueuedMessage = useCallback(
    async (
      msg: QueuedMothershipMessage,
      options: {
        epoch: number
        pendingStop?: Promise<void> | null
        queuedSendHandoff?: QueuedSendHandoffSeed
      }
    ) => {
      if (queuedMessageDispatchIdsRef.current.has(msg.id)) {
        return
      }
      queuedMessageDispatchIdsRef.current.add(msg.id)

      const dispatchChatKey = chatKeyRef.current
      const queueAtStart =
        useMothershipQueueStore.getState().queues[dispatchChatKey] ?? EMPTY_MESSAGE_QUEUE
      let originalIndex = queueAtStart.findIndex((queued) => queued.id === msg.id)
      if (originalIndex === -1) {
        queuedMessageDispatchIdsRef.current.delete(msg.id)
        return
      }

      setDispatchingHeadId(msg.id)

      let removedFromQueue = false
      const removeQueuedMessage = () => {
        if (removedFromQueue || options.epoch !== queueDispatchEpochRef.current) {
          return
        }
        removedFromQueue = true
        useMothershipQueueStore.getState().remove(dispatchChatKey, msg.id)
      }

      const restoreQueuedMessage = (handoff?: QueuedSendHandoffSeed) => {
        if (!handoff) {
          clearQueuedSendHandoffState(msg.id)
        }
        clearQueuedSendHandoffClaim(msg.id)
        if (!removedFromQueue || options.epoch !== queueDispatchEpochRef.current) {
          return
        }
        // If the user explicitly removed this message during dispatch, honor
        // that and don't re-insert on failure.
        if (userRemovedDuringDispatchRef.current.delete(msg.id)) {
          return
        }
        useMothershipQueueStore.getState().insertAt(dispatchChatKey, originalIndex, msg)
      }

      let activeQueuedSendHandoff: QueuedSendHandoffSeed | undefined =
        options.queuedSendHandoff ?? msg.queuedSendHandoff
      try {
        const queueAtSend =
          useMothershipQueueStore.getState().queues[dispatchChatKey] ?? EMPTY_MESSAGE_QUEUE
        const currentIndex = queueAtSend.findIndex((queued) => queued.id === msg.id)
        if (currentIndex === -1) {
          return
        }
        originalIndex = currentIndex

        // Re-read live: the user may have applied an in-place edit (`replaceAt`)
        // between dispatch scheduling and this send.
        const liveMsg = queueAtSend[currentIndex]
        activeQueuedSendHandoff = options.queuedSendHandoff ?? liveMsg.queuedSendHandoff
        const consumed = await startSendMessage(
          liveMsg.content,
          liveMsg.fileAttachments,
          liveMsg.contexts,
          options.pendingStop,
          removeQueuedMessage,
          activeQueuedSendHandoff
        )

        if (!consumed) {
          restoreQueuedMessage(activeQueuedSendHandoff)
        }
      } catch {
        restoreQueuedMessage(activeQueuedSendHandoff)
      } finally {
        setDispatchingHeadId((current) => (current === msg.id ? null : current))
        queuedMessageDispatchIdsRef.current.delete(msg.id)
        userRemovedDuringDispatchRef.current.delete(msg.id)
      }
    },
    [startSendMessage]
  )

  const runQueueDispatchLoop = useCallback(async () => {
    if (queueDispatchTaskRef.current) {
      return queueDispatchTaskRef.current
    }

    const task = (async () => {
      while (true) {
        const action = queueDispatchActionsRef.current.shift()
        if (!action) return

        if (action.epoch !== queueDispatchEpochRef.current) {
          continue
        }

        const queueState = useMothershipQueueStore.getState()
        const activeChatKey = chatKeyRef.current
        const msg = queueState.queues[activeChatKey]?.[0]
        if (!msg) continue
        // Pause draining if the head is bound to the composer; dispatching now
        // would race the eventual submit. The next kick on edit-resolve resumes us.
        if (queueState.editing[activeChatKey] === msg.id) continue

        await dispatchQueuedMessage(msg, { epoch: action.epoch })
      }
    })()

    queueDispatchTaskRef.current = task

    return task.finally(() => {
      if (queueDispatchTaskRef.current === task) {
        queueDispatchTaskRef.current = null
      }
      if (queueDispatchActionsRef.current.length > 0) {
        void queueDispatchLoopRef.current()
      }
    })
  }, [dispatchQueuedMessage])
  queueDispatchLoopRef.current = runQueueDispatchLoop

  const enqueueQueueDispatch = useCallback((action: QueueDispatchActionInput) => {
    const epoch = queueDispatchEpochRef.current
    queueDispatchActionsRef.current.push({ ...action, epoch } as QueueDispatchAction)
    return queueDispatchLoopRef.current()
  }, [])
  enqueueQueueDispatchRef.current = enqueueQueueDispatch

  const removeFromQueue = useCallback((id: string) => {
    // If the message is mid-dispatch, mark it so the dispatch's failure-restore
    // path won't silently undo the user's removal.
    if (queuedMessageDispatchIdsRef.current.has(id)) {
      userRemovedDuringDispatchRef.current.add(id)
    }
    clearQueuedSendHandoffState(id)
    clearQueuedSendHandoffClaim(id)
    useMothershipQueueStore.getState().remove(chatKeyRef.current, id)
  }, [])

  const sendQueuedMessageImmediately = useCallback(
    async (id: string) => {
      const queue = useMothershipQueueStore.getState().queues[chatKeyRef.current]
      const msg = queue?.find((queued) => queued.id === id)
      if (!msg) return
      if (queuedMessageDispatchIdsRef.current.has(msg.id)) return

      // Explicit queue sends should supersede any older auto-drain work scheduled by finalize().
      queueDispatchActionsRef.current = queueDispatchActionsRef.current.filter(
        (queuedAction) => queuedAction.type !== 'send_head'
      )

      const queuedSendHandoff =
        msg.queuedSendHandoff ??
        ((sendingRef.current || pendingStopPromiseRef.current) && workspaceId
          ? (() => {
              const handoffChatId = selectedChatIdRef.current ?? chatIdRef.current
              const cachedActiveStreamId = handoffChatId
                ? queryClient.getQueryData<MothershipChatHistory>(
                    mothershipChatKeys.detail(handoffChatId)
                  )?.activeStreamId
                : undefined
              return {
                id: msg.id,
                ...(handoffChatId ? { chatId: handoffChatId } : {}),
                supersededStreamId:
                  streamIdRef.current ||
                  activeTurnRef.current?.userMessageId ||
                  cachedActiveStreamId ||
                  null,
              }
            })()
          : undefined)

      const pendingStop = sendingRef.current
        ? stopGeneration({
            mode: 'queued-handoff',
          })
        : pendingStopPromiseRef.current

      await dispatchQueuedMessage(msg, {
        epoch: queueDispatchEpochRef.current,
        pendingStop,
        queuedSendHandoff,
      })
    },
    [dispatchQueuedMessage, queryClient, stopGeneration, workspaceId]
  )

  const sendNow = useCallback(
    async (id: string) => {
      await sendQueuedMessageImmediately(id)
    },
    [sendQueuedMessageImmediately]
  )

  const editQueuedMessage = useCallback((id: string): QueuedMessage | undefined => {
    // Reject edits on a message already mid-dispatch; the slot is about to be
    // dropped. UI also disables this via `dispatchingHeadId`.
    if (queuedMessageDispatchIdsRef.current.has(id)) return undefined
    const activeChatKey = chatKeyRef.current
    const queue = useMothershipQueueStore.getState().queues[activeChatKey] ?? EMPTY_MESSAGE_QUEUE
    const msg = queue.find((m) => m.id === id)
    if (!msg) return undefined
    // Evict any sessionStorage handoff — a failed prior dispatch may have left
    // a pre-edit content snapshot that the recovery effect would otherwise replay.
    clearQueuedSendHandoffState(id)
    clearQueuedSendHandoffClaim(id)
    useMothershipQueueStore.getState().setEditing(activeChatKey, id)
    return msg
  }, [])

  const cancelQueueEdit = useCallback(() => {
    useMothershipQueueStore.getState().setEditing(chatKeyRef.current, null)
    // Resume dispatch if it paused on this slot.
    if (!sendingRef.current && !pendingStopPromiseRef.current) {
      void enqueueQueueDispatchRef.current({ type: 'send_head' })
    }
  }, [])

  // Resume draining when a non-empty queue rehydrates with no active stream
  // (e.g. nav-back). Wait for chat history to confirm no `activeStreamId` to
  // avoid racing the reconnect path; mid-stream completions go through
  // `notifyTurnEnded`. Idempotent — the dispatch loop dedupes.
  const chatHistoryReady = chatHistory !== undefined
  const remoteActiveStreamId = chatHistory?.activeStreamId ?? null
  useEffect(() => {
    if (!workspaceId) return
    if (messageQueue.length === 0) return
    if (sendingRef.current || pendingStopPromiseRef.current) return
    if (queueDispatchTaskRef.current) return
    if (resolvedChatId && !chatHistoryReady) return
    if (remoteActiveStreamId) return
    void enqueueQueueDispatchRef.current({ type: 'send_head' })
  }, [workspaceId, messageQueue.length, resolvedChatId, chatHistoryReady, remoteActiveStreamId])

  useEffect(() => {
    return () => {
      cancelActiveStreamRecovery()
      clearQueueDispatchState()
      streamGenRef.current++
      cancelActiveStreamReader()
      abortControllerRef.current?.abort('unmount:client_cleanup')
      abortControllerRef.current = null
      clearActiveTurn()
      sendingRef.current = false
      // Release the editing slot — the composer it binds to is unmounting.
      useMothershipQueueStore.getState().setEditing(chatKeyRef.current, null)
    }
  }, [
    cancelActiveStreamRecovery,
    cancelActiveStreamReader,
    clearQueueDispatchState,
    clearActiveTurn,
  ])

  return {
    messages,
    isSending,
    isReconnecting,
    error,
    resolvedChatId,
    sendMessage,
    stopGeneration,
    resources,
    activeResourceId: effectiveActiveResourceId,
    setActiveResourceId,
    addResource,
    removeResource,
    reorderResources,
    messageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    cancelQueueEdit,
    editingQueuedId,
    dispatchingHeadId,
    previewSession,
    genericResourceData,
    getCurrentRequestId,
  }
}
