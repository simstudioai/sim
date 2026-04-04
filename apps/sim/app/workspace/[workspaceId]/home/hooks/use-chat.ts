import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import {
  cancelRunToolExecution,
  executeRunToolOnClient,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/client-sse/run-tool-execution'
import {
  COPILOT_CHAT_API_PATH,
  COPILOT_CHAT_STREAM_API_PATH,
  MOTHERSHIP_CHAT_API_PATH,
} from '@/lib/copilot/constants'
import {
  extractResourcesFromToolResult,
  isEphemeralResource,
  isResourceToolName,
} from '@/lib/copilot/resource-extraction'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resource-types'
import { isWorkflowToolName } from '@/lib/copilot/workflow-tools'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  ChatMessage,
  ChatMessageAttachment,
  ContentBlock,
  ContentBlockType,
  FileAttachmentForApi,
  GenericResourceData,
  GenericResourceEntry,
  MothershipResource,
  MothershipResourceType,
  QueuedMessage,
  SSEPayload,
  SSEPayloadData,
  ToolCallStatus,
} from '@/app/workspace/[workspaceId]/home/types'
import { deploymentKeys } from '@/hooks/queries/deployments'
import {
  fetchChatHistory,
  type StreamSnapshot,
  type TaskChatHistory,
  type TaskStoredContentBlock,
  type TaskStoredFileAttachment,
  type TaskStoredMessage,
  type TaskStoredToolCall,
  taskKeys,
  useChatHistory,
} from '@/hooks/queries/tasks'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { invalidateWorkflowSelectors } from '@/hooks/queries/utils/invalidate-workflow-lists'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflowById, getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { workflowKeys } from '@/hooks/queries/workflows'
import { useExecutionStream } from '@/hooks/use-execution-stream'
import { useExecutionStore } from '@/stores/execution/store'
import type { ChatContext } from '@/stores/panel'
import { consolePersistence, useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

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
  streamingFile: { fileName: string; content: string } | null
  genericResourceData: GenericResourceData
}

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  rejected: 'error',
  skipped: 'success',
} as const

const DEPLOY_TOOL_NAMES = new Set(['deploy_api', 'deploy_chat', 'deploy_mcp', 'redeploy'])
const RECONNECT_TAIL_ERROR =
  'Live reconnect failed before the stream finished. The latest response may be incomplete.'
const TERMINAL_STREAM_STATUSES = new Set(['complete', 'error', 'cancelled'])
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000

interface StreamEventEnvelope {
  eventId: number
  streamId: string
  event: Record<string, unknown>
}

interface StreamBatchResponse {
  success: boolean
  events: StreamEventEnvelope[]
  status: string
}

interface StreamTerminationResult {
  sawStreamError: boolean
  sawDoneEvent: boolean
  lastEventId: number
}

interface StreamProcessingOptions {
  expectedGen?: number
  initialLastEventId?: number
  preserveExistingState?: boolean
}

interface AttachToStreamOptions {
  streamId: string
  assistantId: string
  expectedGen: number
  snapshot?: StreamSnapshot | null
  initialLastEventId?: number
}

interface AttachToStreamResult {
  aborted: boolean
  error: boolean
}

interface PendingStreamRecovery {
  streamId: string
  snapshot?: StreamSnapshot | null
}

function isTerminalStreamStatus(status?: string | null): boolean {
  return Boolean(status && TERMINAL_STREAM_STATUSES.has(status))
}

function isActiveStreamConflictError(input: unknown): boolean {
  if (typeof input !== 'string') return false
  return input.includes('A response is already in progress for this chat')
}

/**
 * Extracts tool call IDs from snapshot events so that replayed client-executable
 * tool calls are not re-executed after a page refresh.
 */
function extractToolCallIdsFromSnapshot(snapshot?: StreamSnapshot | null): Set<string> {
  const ids = new Set<string>()
  if (!snapshot?.events) return ids
  for (const entry of snapshot.events) {
    const event = entry.event
    if (event.type === 'tool_call' && typeof event.toolCallId === 'string') {
      ids.add(event.toolCallId)
    }
  }
  return ids
}

function buildReplayStream(events: StreamEventEnvelope[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (events.length > 0) {
        const payload = events
          .map(
            (entry) =>
              `data: ${JSON.stringify({ ...entry.event, eventId: entry.eventId, streamId: entry.streamId })}\n\n`
          )
          .join('')
        controller.enqueue(encoder.encode(payload))
      }
      controller.close()
    },
  })
}

function mapStoredBlock(block: TaskStoredContentBlock): ContentBlock {
  if (block.type === 'thinking') {
    return {
      type: 'text',
      content: block.content ? `<thinking>${block.content}</thinking>` : '',
    }
  }

  const mapped: ContentBlock = {
    type: block.type as ContentBlockType,
    content: block.content,
  }

  if (block.type === 'tool_call' && block.toolCall) {
    const resolvedStatus = STATE_TO_STATUS[block.toolCall.state ?? ''] ?? 'error'
    mapped.toolCall = {
      id: block.toolCall.id ?? '',
      name: block.toolCall.name ?? 'unknown',
      status: resolvedStatus,
      displayTitle:
        resolvedStatus === 'cancelled' ? 'Stopped by user' : block.toolCall.display?.text,
      params: block.toolCall.params,
      calledBy: block.toolCall.calledBy,
      result: block.toolCall.result,
    }
  }

  return mapped
}

function mapStoredToolCall(tc: TaskStoredToolCall): ContentBlock {
  const resolvedStatus = (STATE_TO_STATUS[tc.status] ?? 'error') as ToolCallStatus
  return {
    type: 'tool_call',
    toolCall: {
      id: tc.id,
      name: tc.name,
      status: resolvedStatus,
      displayTitle: resolvedStatus === 'cancelled' ? 'Stopped by user' : undefined,
      params: tc.params,
      result:
        tc.result != null
          ? {
              success: tc.status === 'success',
              output: tc.result,
              error: tc.error,
            }
          : undefined,
    },
  }
}

function toDisplayAttachment(f: TaskStoredFileAttachment): ChatMessageAttachment {
  return {
    id: f.id,
    filename: f.filename,
    media_type: f.media_type,
    size: f.size,
    previewUrl: f.media_type.startsWith('image/')
      ? `/api/files/serve/${encodeURIComponent(f.key)}?context=mothership`
      : undefined,
  }
}

function mapStoredMessage(msg: TaskStoredMessage): ChatMessage {
  const mapped: ChatMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    ...(msg.requestId ? { requestId: msg.requestId } : {}),
  }

  const hasContentBlocks = Array.isArray(msg.contentBlocks) && msg.contentBlocks.length > 0
  const hasToolCalls = Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0
  const contentBlocksHaveTools =
    hasContentBlocks && msg.contentBlocks!.some((b) => b.type === 'tool_call')

  if (hasContentBlocks && (!hasToolCalls || contentBlocksHaveTools)) {
    const blocks = msg.contentBlocks!.map(mapStoredBlock)
    const hasText = blocks.some((b) => b.type === 'text' && b.content?.trim())
    if (!hasText && msg.content?.trim()) {
      blocks.push({ type: 'text', content: msg.content })
    }
    mapped.contentBlocks = blocks
  } else if (hasToolCalls) {
    const blocks: ContentBlock[] = msg.toolCalls!.map(mapStoredToolCall)
    if (msg.content?.trim()) {
      blocks.push({ type: 'text', content: msg.content })
    }
    mapped.contentBlocks = blocks
  }

  if (Array.isArray(msg.fileAttachments) && msg.fileAttachments.length > 0) {
    mapped.attachments = msg.fileAttachments.map(toDisplayAttachment)
  }

  if (Array.isArray(msg.contexts) && msg.contexts.length > 0) {
    mapped.contexts = msg.contexts.map((c) => ({
      kind: c.kind,
      label: c.label,
      ...(c.workflowId && { workflowId: c.workflowId }),
      ...(c.knowledgeId && { knowledgeId: c.knowledgeId }),
      ...(c.tableId && { tableId: c.tableId }),
      ...(c.fileId && { fileId: c.fileId }),
    }))
  }

  return mapped
}

const logger = createLogger('useChat')

function getPayloadData(payload: SSEPayload): SSEPayloadData | undefined {
  return typeof payload.data === 'object' ? payload.data : undefined
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
    color: getNextWorkflowColor(),
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

function extractResourceFromReadResult(
  path: string | undefined,
  output: unknown
): MothershipResource | null {
  if (!path) return null

  const segments = path.split('/')
  const resourceType = VFS_DIR_TO_RESOURCE[segments[0]]
  if (!resourceType || !segments[1]) return null

  const obj = output && typeof output === 'object' ? (output as Record<string, unknown>) : undefined
  if (!obj) return null

  let id = obj.id as string | undefined
  let name = obj.name as string | undefined

  if (!id && typeof obj.content === 'string') {
    try {
      const parsed = JSON.parse(obj.content)
      id = parsed?.id as string | undefined
      name = parsed?.name as string | undefined
    } catch {
      // content is not JSON
    }
  }

  if (!id) return null
  return { type: resourceType, id, title: name || segments[1] }
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
}

export function getMothershipUseChatOptions(
  options: Pick<UseChatOptions, 'onResourceEvent' | 'onStreamEnd' | 'initialActiveResourceId'> = {}
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
    'workflowId' | 'onToolResult' | 'onTitleUpdate' | 'onStreamEnd'
  > = {}
): UseChatOptions {
  return {
    apiPath: COPILOT_CHAT_API_PATH,
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
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedChatId, setResolvedChatId] = useState<string | undefined>(initialChatId)
  const [resources, setResources] = useState<MothershipResource[]>([])
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null)
  const initialActiveResourceIdRef = useRef(options?.initialActiveResourceId)
  const onResourceEventRef = useRef(options?.onResourceEvent)
  onResourceEventRef.current = options?.onResourceEvent
  const apiPathRef = useRef(options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH)
  apiPathRef.current = options?.apiPath ?? MOTHERSHIP_CHAT_API_PATH
  const stopPathRef = useRef(options?.stopPath ?? '/api/mothership/chat/stop')
  stopPathRef.current = options?.stopPath ?? '/api/mothership/chat/stop'
  const workflowIdRef = useRef(options?.workflowId)
  workflowIdRef.current = options?.workflowId
  const onToolResultRef = useRef(options?.onToolResult)
  onToolResultRef.current = options?.onToolResult
  const onTitleUpdateRef = useRef(options?.onTitleUpdate)
  onTitleUpdateRef.current = options?.onTitleUpdate
  const onStreamEndRef = useRef(options?.onStreamEnd)
  onStreamEndRef.current = options?.onStreamEnd
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources

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

  const [streamingFile, setStreamingFile] = useState<{
    fileName: string
    content: string
  } | null>(null)
  const streamingFileRef = useRef(streamingFile)
  streamingFileRef.current = streamingFile

  const [genericResourceData, setGenericResourceData] = useState<GenericResourceData>({
    entries: [],
  })
  const genericResourceDataRef = useRef<GenericResourceData>({ entries: [] })

  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
  const messageQueueRef = useRef<QueuedMessage[]>([])
  messageQueueRef.current = messageQueue
  const [pendingRecoveryMessage, setPendingRecoveryMessage] = useState<QueuedMessage | null>(null)
  const pendingRecoveryMessageRef = useRef<QueuedMessage | null>(null)
  pendingRecoveryMessageRef.current = pendingRecoveryMessage

  const sendMessageRef = useRef<UseChatReturn['sendMessage']>(async () => {})
  const processSSEStreamRef = useRef<
    (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      options?: StreamProcessingOptions
    ) => Promise<StreamTerminationResult>
  >(async () => ({
    sawStreamError: false,
    sawDoneEvent: false,
    lastEventId: 0,
  }))
  const finalizeRef = useRef<(options?: { error?: boolean }) => void>(() => {})
  const retryReconnectRef = useRef<
    (opts: {
      streamId: string
      assistantId: string
      gen: number
      initialSnapshot?: StreamSnapshot | null
    }) => Promise<boolean>
  >(async () => false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  /** Panel/task selection — drives createNewChat + request chatId; may differ from chatIdRef while a stream is still finishing. */
  const selectedChatIdRef = useRef<string | undefined>(initialChatId)
  selectedChatIdRef.current = initialChatId
  const appliedChatIdRef = useRef<string | undefined>(undefined)
  const pendingUserMsgRef = useRef<{ id: string; content: string } | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  const lastEventIdRef = useRef(0)
  const sendingRef = useRef(false)
  const streamGenRef = useRef(0)
  const streamingContentRef = useRef('')
  const streamingBlocksRef = useRef<ContentBlock[]>([])
  const clientExecutionStartedRef = useRef<Set<string>>(new Set())
  const executionStream = useExecutionStream()
  const isHomePage = pathname.endsWith('/home')

  const { data: chatHistory } = useChatHistory(initialChatId)

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

    if (isEphemeralResource(resource)) {
      return true
    }

    const persistChatId = chatIdRef.current ?? selectedChatIdRef.current
    if (persistChatId) {
      fetch('/api/copilot/chat/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: persistChatId, resource }),
      }).catch((err) => {
        logger.warn('Failed to persist resource', err)
      })
    }
    return true
  }, [])

  const removeResource = useCallback((resourceType: MothershipResourceType, resourceId: string) => {
    setResources((prev) => prev.filter((r) => !(r.type === resourceType && r.id === resourceId)))
  }, [])

  const reorderResources = useCallback((newOrder: MothershipResource[]) => {
    setResources(newOrder)
  }, [])

  useEffect(() => {
    if (sendingRef.current) {
      const streamOwnerId = chatIdRef.current
      const navigatedToDifferentChat =
        initialChatId !== streamOwnerId &&
        (initialChatId !== undefined || streamOwnerId !== undefined)

      if (navigatedToDifferentChat) {
        const abandonedChatId = streamOwnerId
        // Detach the current UI from the old stream without cancelling it on the server.
        // Reopening that chat later will reconnect through the existing chatHistory flow.
        streamGenRef.current++
        abortControllerRef.current = null
        sendingRef.current = false
        setIsSending(false)
        setIsReconnecting(false)
        lastEventIdRef.current = 0
        pendingRecoveryMessageRef.current = null
        setPendingRecoveryMessage(null)
        if (abandonedChatId) {
          queryClient.invalidateQueries({ queryKey: taskKeys.detail(abandonedChatId) })
        }
      } else {
        setResolvedChatId(initialChatId)
        setMessageQueue([])
        return
      }
    }
    chatIdRef.current = initialChatId
    setResolvedChatId(initialChatId)
    appliedChatIdRef.current = undefined
    setMessages([])
    setError(null)
    setIsSending(false)
    setIsReconnecting(false)
    setResources([])
    setActiveResourceId(null)
    setStreamingFile(null)
    streamingFileRef.current = null
    genericResourceDataRef.current = { entries: [] }
    setGenericResourceData({ entries: [] })
    setMessageQueue([])
    lastEventIdRef.current = 0
    clientExecutionStartedRef.current.clear()
    pendingRecoveryMessageRef.current = null
    setPendingRecoveryMessage(null)
  }, [initialChatId, queryClient])

  useEffect(() => {
    if (workflowIdRef.current) return
    if (!isHomePage || !chatIdRef.current) return
    streamGenRef.current++
    chatIdRef.current = undefined
    setResolvedChatId(undefined)
    appliedChatIdRef.current = undefined
    abortControllerRef.current = null
    sendingRef.current = false
    setMessages([])
    setError(null)
    setIsSending(false)
    setIsReconnecting(false)
    setResources([])
    setActiveResourceId(null)
    setStreamingFile(null)
    streamingFileRef.current = null
    genericResourceDataRef.current = { entries: [] }
    setGenericResourceData({ entries: [] })
    setMessageQueue([])
    lastEventIdRef.current = 0
    clientExecutionStartedRef.current.clear()
    pendingRecoveryMessageRef.current = null
    setPendingRecoveryMessage(null)
  }, [isHomePage])

  const fetchStreamBatch = useCallback(
    async (
      streamId: string,
      fromEventId: number,
      signal?: AbortSignal
    ): Promise<StreamBatchResponse> => {
      const response = await fetch(
        `${COPILOT_CHAT_STREAM_API_PATH}?streamId=${encodeURIComponent(streamId)}&from=${fromEventId}&batch=true`,
        { signal }
      )

      if (!response.ok) {
        throw new Error(`Stream resume batch failed: ${response.status}`)
      }

      return response.json()
    },
    []
  )

  const attachToExistingStream = useCallback(
    async ({
      streamId,
      assistantId,
      expectedGen,
      snapshot,
      initialLastEventId = 0,
    }: AttachToStreamOptions): Promise<AttachToStreamResult> => {
      let latestEventId = initialLastEventId
      let seedEvents = snapshot?.events ?? []
      let streamStatus = snapshot?.status ?? 'unknown'
      let attachAttempt = 0

      setIsSending(true)
      setIsReconnecting(true)
      setError(null)

      logger.info('Attaching to existing stream', {
        streamId,
        expectedGen,
        initialLastEventId,
        seedEventCount: seedEvents.length,
        streamStatus,
      })

      try {
        while (streamGenRef.current === expectedGen) {
          if (seedEvents.length > 0) {
            const replayResult = await processSSEStreamRef.current(
              buildReplayStream(seedEvents).getReader(),
              assistantId,
              {
                expectedGen,
                initialLastEventId: latestEventId,
                preserveExistingState: true,
              }
            )
            latestEventId = Math.max(
              replayResult.lastEventId,
              seedEvents[seedEvents.length - 1]?.eventId ?? latestEventId
            )
            lastEventIdRef.current = latestEventId
            seedEvents = []

            if (replayResult.sawStreamError) {
              logger.warn('Replay stream ended with error event', { streamId, latestEventId })
              return { aborted: false, error: true }
            }
          }

          if (isTerminalStreamStatus(streamStatus)) {
            logger.info('Existing stream already reached terminal status', {
              streamId,
              latestEventId,
              streamStatus,
            })
            if (streamStatus === 'error') {
              setError(RECONNECT_TAIL_ERROR)
            }
            return { aborted: false, error: streamStatus === 'error' }
          }

          const activeAbortController = abortControllerRef.current
          if (!activeAbortController) {
            return { aborted: true, error: false }
          }

          logger.info('Opening live stream tail', {
            streamId,
            fromEventId: latestEventId,
            attempt: attachAttempt,
          })

          const sseRes = await fetch(
            `${COPILOT_CHAT_STREAM_API_PATH}?streamId=${encodeURIComponent(streamId)}&from=${latestEventId}`,
            { signal: activeAbortController.signal }
          )
          if (!sseRes.ok || !sseRes.body) {
            throw new Error(RECONNECT_TAIL_ERROR)
          }

          setIsReconnecting(false)

          const liveResult = await processSSEStreamRef.current(
            sseRes.body.getReader(),
            assistantId,
            {
              expectedGen,
              initialLastEventId: latestEventId,
              preserveExistingState: true,
            }
          )
          latestEventId = Math.max(latestEventId, liveResult.lastEventId)
          lastEventIdRef.current = latestEventId

          if (liveResult.sawStreamError) {
            logger.warn('Live stream tail ended with error event', { streamId, latestEventId })
            return { aborted: false, error: true }
          }

          attachAttempt += 1
          setIsReconnecting(true)

          logger.warn('Live stream ended without terminal event, fetching replay batch', {
            streamId,
            latestEventId,
            attempt: attachAttempt,
          })

          const batch = await fetchStreamBatch(
            streamId,
            latestEventId,
            activeAbortController.signal
          )
          seedEvents = batch.events
          streamStatus = batch.status

          if (batch.events.length > 0) {
            latestEventId = batch.events[batch.events.length - 1].eventId
            lastEventIdRef.current = latestEventId
          }

          logger.info('Fetched replay batch after non-terminal stream close', {
            streamId,
            latestEventId,
            streamStatus,
            eventCount: batch.events.length,
            attempt: attachAttempt,
          })

          if (batch.events.length === 0 && !isTerminalStreamStatus(batch.status)) {
            logger.info('No new replay events yet; reopening active stream tail', {
              streamId,
              latestEventId,
              streamStatus,
              attempt: attachAttempt,
            })
            if (activeAbortController.signal.aborted || streamGenRef.current !== expectedGen) {
              return { aborted: true, error: false }
            }
          }
        }

        return { aborted: true, error: false }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { aborted: true, error: false }
        }

        logger.error('Failed to attach to existing stream, will throw for outer retry', {
          streamId,
          latestEventId,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      } finally {
        setIsReconnecting(false)
      }
    },
    [fetchStreamBatch]
  )

  const applyChatHistorySnapshot = useCallback(
    (history: TaskChatHistory, options?: { preserveActiveStreamingMessage?: boolean }) => {
      const preserveActiveStreamingMessage = options?.preserveActiveStreamingMessage ?? false
      const activeStreamId = history.activeStreamId
      appliedChatIdRef.current = history.id

      const mappedMessages = history.messages.map(mapStoredMessage)
      const shouldPreserveActiveStreamingMessage =
        preserveActiveStreamingMessage &&
        sendingRef.current &&
        Boolean(activeStreamId) &&
        activeStreamId === streamIdRef.current

      if (shouldPreserveActiveStreamingMessage) {
        setMessages((prev) => {
          const localStreamingAssistant = prev[prev.length - 1]
          if (localStreamingAssistant?.role !== 'assistant') {
            return mappedMessages
          }

          const nextMessages =
            mappedMessages[mappedMessages.length - 1]?.role === 'assistant'
              ? mappedMessages.slice(0, -1)
              : mappedMessages

          return [...nextMessages, localStreamingAssistant]
        })
      } else {
        setMessages(mappedMessages)
      }

      if (history.resources.some((r) => r.id === 'streaming-file')) {
        fetch('/api/copilot/chat/resources', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: history.id,
            resourceType: 'file',
            resourceId: 'streaming-file',
          }),
        }).catch(() => {})
      }

      const persistedResources = history.resources.filter((r) => r.id !== 'streaming-file')
      if (persistedResources.length > 0) {
        setResources(persistedResources)
        const initialId = initialActiveResourceIdRef.current
        const restoredId =
          initialId && persistedResources.some((r) => r.id === initialId)
            ? initialId
            : persistedResources[persistedResources.length - 1].id
        setActiveResourceId(restoredId)

        for (const resource of persistedResources) {
          if (resource.type !== 'workflow') continue
          ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
        }
      } else if (history.resources.some((r) => r.id === 'streaming-file')) {
        setResources([])
        setActiveResourceId(null)
      }
    },
    [workspaceId]
  )

  const preparePendingStreamRecovery = useCallback(
    async (chatId: string): Promise<PendingStreamRecovery | null> => {
      const latestHistory = await fetchChatHistory(chatId)
      queryClient.setQueryData(taskKeys.detail(chatId), latestHistory)
      applyChatHistorySnapshot(latestHistory)

      if (!latestHistory.activeStreamId) {
        return null
      }

      return {
        streamId: latestHistory.activeStreamId,
        snapshot: latestHistory.streamSnapshot,
      }
    },
    [applyChatHistorySnapshot, queryClient]
  )

  useEffect(() => {
    if (!chatHistory) return

    const activeStreamId = chatHistory.activeStreamId
    const snapshot = chatHistory.streamSnapshot
    const isNewChat = appliedChatIdRef.current !== chatHistory.id

    if (isNewChat) {
      applyChatHistorySnapshot(chatHistory, { preserveActiveStreamingMessage: true })
    } else if (!activeStreamId || sendingRef.current) {
      return
    }

    if (activeStreamId && !sendingRef.current) {
      const gen = ++streamGenRef.current
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      streamIdRef.current = activeStreamId
      lastEventIdRef.current = snapshot?.events?.[snapshot.events.length - 1]?.eventId ?? 0
      sendingRef.current = true
      streamingContentRef.current = ''
      streamingBlocksRef.current = []
      clientExecutionStartedRef.current = extractToolCallIdsFromSnapshot(snapshot)

      const assistantId = crypto.randomUUID()

      const reconnect = async () => {
        const succeeded = await retryReconnectRef.current({
          streamId: activeStreamId,
          assistantId,
          gen,
          initialSnapshot: snapshot,
        })
        if (!succeeded && streamGenRef.current === gen) {
          try {
            finalizeRef.current({ error: true })
          } catch {
            sendingRef.current = false
            setIsSending(false)
            setIsReconnecting(false)
            abortControllerRef.current = null
            setError('Failed to reconnect to the active stream')
          }
        }
      }
      reconnect()
    }
  }, [applyChatHistorySnapshot, chatHistory, queryClient])

  const processSSEStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      options?: StreamProcessingOptions
    ) => {
      const { expectedGen, initialLastEventId = 0, preserveExistingState = false } = options ?? {}
      const decoder = new TextDecoder()
      streamReaderRef.current = reader
      let buffer = ''
      const blocks: ContentBlock[] = preserveExistingState ? [...streamingBlocksRef.current] : []
      const toolMap = new Map<string, number>()
      const toolArgsMap = new Map<string, Record<string, unknown>>()
      // Maps toolCallId → index in genericResourceDataRef.current.entries for fast lookup
      const genericEntryMap = new Map<string, number>()
      if (preserveExistingState) {
        for (const [idx, entry] of genericResourceDataRef.current.entries.entries()) {
          genericEntryMap.set(entry.toolCallId, idx)
        }
      }
      const clientExecutionStarted = clientExecutionStartedRef.current
      let activeSubagent: string | undefined
      let activeCompactionId: string | undefined
      let runningText = preserveExistingState ? streamingContentRef.current : ''
      let lastContentSource: 'main' | 'subagent' | null = null
      let streamRequestId: string | undefined
      let lastEventId = initialLastEventId
      let sawDoneEvent = false

      if (!preserveExistingState) {
        streamingContentRef.current = ''
        streamingBlocksRef.current = []
      }

      for (const [index, block] of blocks.entries()) {
        if (block.type === 'tool_call' && block.toolCall?.id) {
          toolMap.set(block.toolCall.id, index)
          if (block.toolCall.params) {
            toolArgsMap.set(block.toolCall.id, block.toolCall.params)
          }
        }
      }

      const ensureTextBlock = (): ContentBlock => {
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text' && last.subagent === activeSubagent) return last
        const b: ContentBlock = { type: 'text', content: '' }
        blocks.push(b)
        return b
      }

      const appendInlineErrorTag = (tag: string) => {
        if (runningText.includes(tag)) return
        const tb = ensureTextBlock()
        const prefix = runningText.length > 0 && !runningText.endsWith('\n') ? '\n' : ''
        tb.content = `${tb.content ?? ''}${prefix}${tag}`
        if (activeSubagent) tb.subagent = activeSubagent
        runningText += `${prefix}${tag}`
        streamingContentRef.current = runningText
        flush()
      }

      const buildInlineErrorTag = (payload: SSEPayload) => {
        const data = getPayloadData(payload) as Record<string, unknown> | undefined
        const message =
          (data?.displayMessage as string | undefined) ||
          payload.error ||
          'An unexpected error occurred'
        const provider = (data?.provider as string | undefined) || undefined
        const code = (data?.code as string | undefined) || undefined
        return `<mothership-error>${JSON.stringify({
          message,
          ...(code ? { code } : {}),
          ...(provider ? { provider } : {}),
        })}</mothership-error>`
      }

      const isStale = () => expectedGen !== undefined && streamGenRef.current !== expectedGen
      let sawStreamError = false

      const flush = () => {
        if (isStale()) return
        streamingBlocksRef.current = [...blocks]
        const snapshot: Partial<ChatMessage> = {
          content: runningText,
          contentBlocks: [...blocks],
        }
        if (streamRequestId) snapshot.requestId = streamRequestId
        setMessages((prev) => {
          if (expectedGen !== undefined && streamGenRef.current !== expectedGen) return prev
          const idx = prev.findIndex((m) => m.id === assistantId)
          if (idx >= 0) {
            return prev.map((m) => (m.id === assistantId ? { ...m, ...snapshot } : m))
          }
          return [
            ...prev,
            { id: assistantId, role: 'assistant' as const, content: '', ...snapshot },
          ]
        })
      }

      const appendGenericEntry = (entry: GenericResourceEntry): number => {
        const entries = [...genericResourceDataRef.current.entries, entry]
        genericResourceDataRef.current.entries = entries
        setGenericResourceData({ entries })
        return entries.length - 1
      }

      const updateGenericEntry = (
        entryIdx: number,
        changes: Partial<GenericResourceEntry>
      ): void => {
        const entries = genericResourceDataRef.current.entries.slice()
        entries[entryIdx] = { ...entries[entryIdx], ...changes }
        genericResourceDataRef.current.entries = entries
        setGenericResourceData({ entries })
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (isStale()) continue

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (isStale()) break
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6)

            let parsed: SSEPayload
            try {
              parsed = JSON.parse(raw)
            } catch {
              continue
            }

            if (typeof (parsed as SSEPayload & { eventId?: unknown }).eventId === 'number') {
              lastEventId = Math.max(
                lastEventId,
                (parsed as SSEPayload & { eventId: number }).eventId
              )
              lastEventIdRef.current = lastEventId
            }

            logger.debug('SSE event received', parsed)
            switch (parsed.type) {
              case 'chat_id': {
                if (parsed.chatId) {
                  const isNewChat = !chatIdRef.current
                  chatIdRef.current = parsed.chatId
                  const selected = selectedChatIdRef.current
                  if (selected == null) {
                    if (isNewChat) {
                      setResolvedChatId(parsed.chatId)
                    }
                  } else if (parsed.chatId === selected) {
                    setResolvedChatId(parsed.chatId)
                  }
                  queryClient.invalidateQueries({
                    queryKey: taskKeys.list(workspaceId),
                  })
                  if (isNewChat) {
                    const userMsg = pendingUserMsgRef.current
                    const activeStreamId = streamIdRef.current
                    if (userMsg && activeStreamId) {
                      queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(parsed.chatId), {
                        id: parsed.chatId,
                        title: null,
                        messages: [
                          {
                            id: userMsg.id,
                            role: 'user',
                            content: userMsg.content,
                          },
                        ],
                        activeStreamId,
                        resources: [],
                      })
                    }
                    if (!workflowIdRef.current) {
                      window.history.replaceState(
                        null,
                        '',
                        `/workspace/${workspaceId}/task/${parsed.chatId}`
                      )
                    }
                  }
                }
                break
              }
              case 'request_id': {
                const rid = typeof parsed.data === 'string' ? parsed.data : undefined
                if (rid) {
                  streamRequestId = rid
                  flush()
                }
                break
              }
              case 'content': {
                const chunk = typeof parsed.data === 'string' ? parsed.data : (parsed.content ?? '')
                if (chunk) {
                  const contentSource: 'main' | 'subagent' = activeSubagent ? 'subagent' : 'main'
                  const needsBoundaryNewline =
                    lastContentSource !== null &&
                    lastContentSource !== contentSource &&
                    runningText.length > 0 &&
                    !runningText.endsWith('\n')
                  const tb = ensureTextBlock()
                  const normalizedChunk = needsBoundaryNewline ? `\n${chunk}` : chunk
                  tb.content = (tb.content ?? '') + normalizedChunk
                  if (activeSubagent) tb.subagent = activeSubagent
                  runningText += normalizedChunk
                  lastContentSource = contentSource
                  streamingContentRef.current = runningText
                  flush()
                }
                break
              }
              case 'reasoning': {
                const d = (
                  parsed.data && typeof parsed.data === 'object' ? parsed.data : {}
                ) as Record<string, unknown>
                const phase = d.phase as string | undefined
                if (phase === 'start') {
                  const tb = ensureTextBlock()
                  tb.content = `${tb.content ?? ''}<thinking>`
                  runningText += '<thinking>'
                  streamingContentRef.current = runningText
                  flush()
                } else if (phase === 'end') {
                  const tb = ensureTextBlock()
                  tb.content = `${tb.content ?? ''}</thinking>`
                  runningText += '</thinking>'
                  streamingContentRef.current = runningText
                  flush()
                } else {
                  const chunk =
                    typeof d.data === 'string' ? d.data : (parsed.content as string | undefined)
                  if (chunk) {
                    const tb = ensureTextBlock()
                    tb.content = (tb.content ?? '') + chunk
                    runningText += chunk
                    streamingContentRef.current = runningText
                    flush()
                  }
                }
                break
              }
              case 'tool_generating':
              case 'tool_call': {
                const id = parsed.toolCallId
                const data = getPayloadData(parsed)
                const name = parsed.toolName || data?.name || 'unknown'
                const isPartial = data?.partial === true
                if (!id) break

                if (name === 'tool_search_tool_regex') {
                  break
                }
                const ui = parsed.ui || data?.ui
                if (ui?.hidden) break
                const displayTitle = ui?.title || ui?.phaseLabel
                const phaseLabel = ui?.phaseLabel
                const args = (data?.arguments ?? data?.input) as Record<string, unknown> | undefined
                if (!toolMap.has(id)) {
                  toolMap.set(id, blocks.length)
                  blocks.push({
                    type: 'tool_call',
                    toolCall: {
                      id,
                      name,
                      status: 'executing',
                      displayTitle,
                      phaseLabel,
                      params: args,
                      calledBy: activeSubagent,
                    },
                  })
                  if (name === 'read' || isResourceToolName(name)) {
                    if (args) toolArgsMap.set(id, args)
                  }
                } else {
                  const idx = toolMap.get(id)!
                  const tc = blocks[idx].toolCall
                  if (tc) {
                    tc.name = name
                    if (displayTitle) tc.displayTitle = displayTitle
                    if (phaseLabel) tc.phaseLabel = phaseLabel
                    if (args) tc.params = args
                  }
                }
                flush()

                // TODO: Uncomment when rich UI for Results tab is ready
                // if (shouldOpenGenericResource(name)) {
                //   if (!genericEntryMap.has(id)) {
                //     const entryIdx = appendGenericEntry({
                //       toolCallId: id,
                //       toolName: name,
                //       displayTitle: displayTitle ?? name,
                //       status: 'executing',
                //       params: args,
                //     })
                //     genericEntryMap.set(id, entryIdx)
                //     const opened = addResource({ type: 'generic', id: 'results', title: 'Results' })
                //     if (opened) onResourceEventRef.current?.()
                //     else setActiveResourceId('results')
                //   } else {
                //     const entryIdx = genericEntryMap.get(id)
                //     if (entryIdx !== undefined) {
                //       updateGenericEntry(entryIdx, {
                //         toolName: name,
                //         ...(displayTitle && { displayTitle }),
                //         ...(args && { params: args }),
                //       })
                //     }
                //   }
                // }

                if (
                  parsed.type === 'tool_call' &&
                  ui?.clientExecutable &&
                  isWorkflowToolName(name) &&
                  !isPartial &&
                  !clientExecutionStarted.has(id)
                ) {
                  clientExecutionStarted.add(id)
                  const args = data?.arguments ?? data?.input ?? {}
                  const targetWorkflowId =
                    typeof (args as Record<string, unknown>).workflowId === 'string'
                      ? ((args as Record<string, unknown>).workflowId as string)
                      : useWorkflowRegistry.getState().activeWorkflowId
                  if (targetWorkflowId) {
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
                  }
                  executeRunToolOnClient(id, name, args as Record<string, unknown>)
                }
                break
              }
              case 'tool_call_delta': {
                const id = parsed.toolCallId
                const delta = typeof parsed.data === 'string' ? parsed.data : ''
                if (!id || !delta) break

                const toolName = typeof parsed.toolName === 'string' ? parsed.toolName : ''
                const streamWorkspaceFile =
                  activeSubagent === 'file_write' || toolName === 'workspace_file'

                if (streamWorkspaceFile) {
                  let prev = streamingFileRef.current
                  if (!prev) {
                    prev = { fileName: '', content: '' }
                    streamingFileRef.current = prev
                    setStreamingFile(prev)
                  }
                  const raw = prev.content + delta
                  let fileName = prev.fileName
                  if (!fileName) {
                    const m = raw.match(/"fileName"\s*:\s*"([^"]+)"/)
                    if (m) {
                      fileName = m[1]
                    }
                  }
                  const fileIdMatch = raw.match(/"fileId"\s*:\s*"([^"]+)"/)
                  const matchedResourceId = fileIdMatch?.[1]
                  if (
                    matchedResourceId &&
                    resourcesRef.current.some(
                      (resource) => resource.type === 'file' && resource.id === matchedResourceId
                    )
                  ) {
                    setActiveResourceId(matchedResourceId)
                    setResources((rs) => rs.filter((resource) => resource.id !== 'streaming-file'))
                  } else if (fileName || fileIdMatch) {
                    const hasStreamingResource = resourcesRef.current.some(
                      (resource) => resource.id === 'streaming-file'
                    )
                    if (!hasStreamingResource) {
                      addResource({
                        type: 'file',
                        id: 'streaming-file',
                        title: fileName || 'Writing file...',
                      })
                    } else if (fileName) {
                      setResources((rs) =>
                        rs.map((resource) =>
                          resource.id === 'streaming-file'
                            ? { ...resource, title: fileName }
                            : resource
                        )
                      )
                    }
                  }
                  const next = { fileName, content: raw }
                  streamingFileRef.current = next
                  setStreamingFile(next)
                }

                const idx = toolMap.get(id)
                if (idx !== undefined && blocks[idx].toolCall) {
                  const tc = blocks[idx].toolCall!
                  tc.streamingArgs = (tc.streamingArgs ?? '') + delta
                  flush()
                }

                // TODO: Uncomment when rich UI for Results tab is ready
                // if (toolName && shouldOpenGenericResource(toolName)) {
                //   const entryIdx = genericEntryMap.get(id)
                //   if (entryIdx !== undefined) {
                //     const entry = genericResourceDataRef.current.entries[entryIdx]
                //     if (entry) {
                //       updateGenericEntry(entryIdx, {
                //         streamingArgs: (entry.streamingArgs ?? '') + delta,
                //       })
                //     }
                //   }
                // }

                break
              }
              case 'tool_result': {
                const id = parsed.toolCallId || getPayloadData(parsed)?.id
                if (!id) break
                const idx = toolMap.get(id)
                if (idx !== undefined && blocks[idx].toolCall) {
                  const tc = blocks[idx].toolCall!

                  const payloadData = getPayloadData(parsed)
                  const resultObj =
                    parsed.result && typeof parsed.result === 'object'
                      ? (parsed.result as Record<string, unknown>)
                      : undefined
                  const isCancelled =
                    resultObj?.reason === 'user_cancelled' ||
                    resultObj?.cancelledByUser === true ||
                    (payloadData as Record<string, unknown> | undefined)?.reason ===
                      'user_cancelled' ||
                    (payloadData as Record<string, unknown> | undefined)?.cancelledByUser === true

                  if (isCancelled) {
                    tc.status = 'cancelled'
                    tc.displayTitle = 'Stopped by user'
                  } else {
                    tc.status = parsed.success ? 'success' : 'error'
                  }
                  tc.streamingArgs = undefined
                  tc.result = {
                    success: !!parsed.success,
                    output: parsed.result ?? getPayloadData(parsed)?.result,
                    error: (parsed.error ?? getPayloadData(parsed)?.error) as string | undefined,
                  }
                  flush()

                  if (tc.name === 'read' && tc.status === 'success') {
                    const readArgs = toolArgsMap.get(id)
                    const resource = extractResourceFromReadResult(
                      readArgs?.path as string | undefined,
                      tc.result.output
                    )
                    if (resource && addResource(resource)) {
                      onResourceEventRef.current?.()
                    }
                  }

                  if (DEPLOY_TOOL_NAMES.has(tc.name) && tc.status === 'success') {
                    const output = tc.result?.output as Record<string, unknown> | undefined
                    const deployedWorkflowId = (output?.workflowId as string) ?? undefined
                    if (deployedWorkflowId && typeof output?.isDeployed === 'boolean') {
                      queryClient.invalidateQueries({
                        queryKey: deploymentKeys.info(deployedWorkflowId),
                      })
                      queryClient.invalidateQueries({
                        queryKey: deploymentKeys.versions(deployedWorkflowId),
                      })
                      queryClient.invalidateQueries({
                        queryKey: workflowKeys.list(workspaceId),
                      })
                    }
                  }

                  const extractedResources =
                    tc.status === 'success' && isResourceToolName(tc.name)
                      ? extractResourcesFromToolResult(
                          tc.name,
                          toolArgsMap.get(id) as Record<string, unknown> | undefined,
                          tc.result?.output
                        )
                      : []

                  for (const resource of extractedResources) {
                    invalidateResourceQueries(queryClient, workspaceId, resource.type, resource.id)
                  }

                  onToolResultRef.current?.(tc.name, tc.status === 'success', tc.result?.output)

                  if (tc.name === 'workspace_file') {
                    setStreamingFile(null)
                    streamingFileRef.current = null

                    const fileResource = extractedResources.find((r) => r.type === 'file')
                    if (fileResource) {
                      setResources((rs) => {
                        const without = rs.filter((r) => r.id !== 'streaming-file')
                        if (without.some((r) => r.type === 'file' && r.id === fileResource.id)) {
                          return without
                        }
                        return [...without, fileResource]
                      })
                      setActiveResourceId(fileResource.id)
                    } else {
                      setResources((rs) => rs.filter((r) => r.id !== 'streaming-file'))
                    }
                  }

                  // TODO: Uncomment when rich UI for Results tab is ready
                  // if (
                  //   shouldOpenGenericResource(tc.name) ||
                  //   (isDeferredResourceTool(tc.name) && extractedResources.length === 0)
                  // ) {
                  //   const entryIdx = genericEntryMap.get(id)
                  //   if (entryIdx !== undefined) {
                  //     updateGenericEntry(entryIdx, {
                  //       status: tc.status,
                  //       result: tc.result ?? undefined,
                  //       streamingArgs: undefined,
                  //     })
                  //   } else {
                  //     const newIdx = appendGenericEntry({
                  //       toolCallId: id,
                  //       toolName: tc.name,
                  //       displayTitle: tc.displayTitle ?? tc.name,
                  //       status: tc.status,
                  //       params: toolArgsMap.get(id) as Record<string, unknown> | undefined,
                  //       result: tc.result ?? undefined,
                  //     })
                  //     genericEntryMap.set(id, newIdx)
                  //     if (addResource({ type: 'generic', id: 'results', title: 'Results' })) {
                  //       onResourceEventRef.current?.()
                  //     }
                  //   }
                  // }
                }

                break
              }
              case 'resource_added': {
                const resource = parsed.resource
                if (resource?.type && resource?.id) {
                  const wasAdded = addResource(resource)
                  invalidateResourceQueries(queryClient, workspaceId, resource.type, resource.id)

                  if (!wasAdded && activeResourceIdRef.current !== resource.id) {
                    setActiveResourceId(resource.id)
                  }
                  onResourceEventRef.current?.()

                  if (resource.type === 'workflow') {
                    const wasRegistered = ensureWorkflowInRegistry(
                      resource.id,
                      resource.title,
                      workspaceId
                    )
                    if (wasAdded && wasRegistered) {
                      useWorkflowRegistry.getState().setActiveWorkflow(resource.id)
                    } else {
                      useWorkflowRegistry.getState().loadWorkflowState(resource.id)
                    }
                  }
                }
                break
              }
              case 'resource_deleted': {
                const resource = parsed.resource
                if (resource?.type && resource?.id) {
                  removeResource(resource.type as MothershipResourceType, resource.id)
                  invalidateResourceQueries(
                    queryClient,
                    workspaceId,
                    resource.type as MothershipResourceType,
                    resource.id
                  )
                  onResourceEventRef.current?.()
                }
                break
              }
              case 'context_compaction_start': {
                const compactionId = `compaction_${Date.now()}`
                activeCompactionId = compactionId
                toolMap.set(compactionId, blocks.length)
                blocks.push({
                  type: 'tool_call',
                  toolCall: {
                    id: compactionId,
                    name: 'context_compaction',
                    status: 'executing',
                    displayTitle: 'Compacting context...',
                  },
                })
                flush()
                break
              }
              case 'context_compaction': {
                const compactionId = activeCompactionId || `compaction_${Date.now()}`
                activeCompactionId = undefined
                const idx = toolMap.get(compactionId)
                if (idx !== undefined && blocks[idx]?.toolCall) {
                  blocks[idx].toolCall!.status = 'success'
                  blocks[idx].toolCall!.displayTitle = 'Compacted context'
                } else {
                  toolMap.set(compactionId, blocks.length)
                  blocks.push({
                    type: 'tool_call',
                    toolCall: {
                      id: compactionId,
                      name: 'context_compaction',
                      status: 'success',
                      displayTitle: 'Compacted context',
                    },
                  })
                }
                flush()
                break
              }
              case 'tool_error': {
                const id = parsed.toolCallId || getPayloadData(parsed)?.id
                if (!id) break
                const idx = toolMap.get(id)
                if (idx !== undefined && blocks[idx].toolCall) {
                  const toolCallName = blocks[idx].toolCall!.name
                  blocks[idx].toolCall!.status = 'error'
                  if (toolCallName === 'workspace_file') {
                    setStreamingFile(null)
                    streamingFileRef.current = null
                    setResources((rs) => rs.filter((resource) => resource.id !== 'streaming-file'))
                  }
                  flush()

                  // TODO: Uncomment when rich UI for Results tab is ready
                  // if (toolCallName && shouldOpenGenericResource(toolCallName)) {
                  //   const entryIdx = genericEntryMap.get(id)
                  //   if (entryIdx !== undefined) {
                  //     updateGenericEntry(entryIdx, { status: 'error', streamingArgs: undefined })
                  //   }
                  // }
                }
                break
              }
              case 'subagent_start': {
                const name = parsed.subagent || getPayloadData(parsed)?.agent
                if (name) {
                  activeSubagent = name
                  blocks.push({ type: 'subagent', content: name })
                  if (name === 'file_write') {
                    const emptyFile = { fileName: '', content: '' }
                    // Ref must be updated synchronously: tool_call_delta can arrive before React
                    // re-renders after setStreamingFile, and the handler only appends when prev exists.
                    streamingFileRef.current = emptyFile
                    setStreamingFile(emptyFile)
                  }
                  flush()
                }
                break
              }
              case 'subagent_end': {
                activeSubagent = undefined
                blocks.push({ type: 'subagent_end' })
                flush()
                break
              }
              case 'title_updated': {
                queryClient.invalidateQueries({
                  queryKey: taskKeys.list(workspaceId),
                })
                onTitleUpdateRef.current?.()
                break
              }
              case 'error': {
                sawStreamError = true
                setError(parsed.error || 'An error occurred')
                appendInlineErrorTag(buildInlineErrorTag(parsed))
                break
              }
              case 'done': {
                sawDoneEvent = true
                break
              }
            }
          }
        }
      } finally {
        if (streamReaderRef.current === reader) {
          streamReaderRef.current = null
        }
      }
      return {
        sawStreamError,
        sawDoneEvent,
        lastEventId,
      }
    },
    [workspaceId, queryClient, addResource, removeResource]
  )
  processSSEStreamRef.current = processSSEStream

  const persistPartialResponse = useCallback(async () => {
    const chatId = chatIdRef.current
    const streamId = streamIdRef.current
    if (!chatId || !streamId) return

    const content = streamingContentRef.current

    const storedBlocks: TaskStoredContentBlock[] = streamingBlocksRef.current.map((block) => {
      if (block.type === 'tool_call' && block.toolCall) {
        const isCancelled =
          block.toolCall.status === 'executing' || block.toolCall.status === 'cancelled'
        return {
          type: block.type,
          content: block.content,
          toolCall: {
            id: block.toolCall.id,
            name: block.toolCall.name,
            state: isCancelled ? 'cancelled' : block.toolCall.status,
            params: block.toolCall.params,
            result: block.toolCall.result,
            display: {
              text: isCancelled ? 'Stopped by user' : block.toolCall.displayTitle,
            },
            calledBy: block.toolCall.calledBy,
          },
        }
      }
      return { type: block.type, content: block.content }
    })

    if (storedBlocks.length > 0) {
      storedBlocks.push({ type: 'stopped' })
    }

    try {
      const res = await fetch(stopPathRef.current, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          streamId,
          content,
          ...(storedBlocks.length > 0 && { contentBlocks: storedBlocks }),
        }),
      })
      if (res.ok) {
        streamingContentRef.current = ''
        streamingBlocksRef.current = []
      }
    } catch (err) {
      logger.warn('Failed to persist partial response', err)
    }
  }, [])

  const invalidateChatQueries = useCallback(() => {
    const activeChatId = chatIdRef.current
    if (activeChatId) {
      queryClient.invalidateQueries({
        queryKey: taskKeys.detail(activeChatId),
      })
    }
    queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
  }, [workspaceId, queryClient])

  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const visibleMessageQueue = useMemo(
    () =>
      pendingRecoveryMessage
        ? [
            pendingRecoveryMessage,
            ...messageQueue.filter((msg) => msg.id !== pendingRecoveryMessage.id),
          ]
        : messageQueue,
    [messageQueue, pendingRecoveryMessage]
  )

  const finalize = useCallback(
    (options?: { error?: boolean }) => {
      sendingRef.current = false
      setIsSending(false)
      setIsReconnecting(false)
      abortControllerRef.current = null
      invalidateChatQueries()

      if (!options?.error) {
        const cid = chatIdRef.current
        if (cid && onStreamEndRef.current) {
          onStreamEndRef.current(cid, messagesRef.current)
        }
      }

      if (options?.error) {
        pendingRecoveryMessageRef.current = null
        setPendingRecoveryMessage(null)
        setMessageQueue([])
        return
      }

      const recoveryMessage = pendingRecoveryMessageRef.current
      if (recoveryMessage) {
        setPendingRecoveryMessage(null)
        const gen = streamGenRef.current
        queueMicrotask(() => {
          if (streamGenRef.current !== gen) return
          sendMessageRef.current(
            recoveryMessage.content,
            recoveryMessage.fileAttachments,
            recoveryMessage.contexts
          )
        })
        return
      }

      const next = messageQueueRef.current[0]
      if (next) {
        setMessageQueue((prev) => prev.filter((m) => m.id !== next.id))
        const gen = streamGenRef.current
        queueMicrotask(() => {
          if (streamGenRef.current !== gen) return
          sendMessageRef.current(next.content, next.fileAttachments, next.contexts)
        })
      }
    },
    [invalidateChatQueries]
  )
  finalizeRef.current = finalize

  const resumeOrFinalize = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      gen: number
      fromEventId: number
      snapshot?: StreamSnapshot | null
      signal?: AbortSignal
    }): Promise<void> => {
      const { streamId, assistantId, gen, fromEventId, snapshot, signal } = opts

      const batch =
        snapshot ??
        (await (async () => {
          const b = await fetchStreamBatch(streamId, fromEventId, signal)
          if (streamGenRef.current !== gen) return null
          return { events: b.events, status: b.status } as StreamSnapshot
        })())

      if (!batch || streamGenRef.current !== gen) return

      if (isTerminalStreamStatus(batch.status)) {
        finalize(batch.status === 'error' ? { error: true } : undefined)
        return
      }

      const reconnectResult = await attachToExistingStream({
        streamId,
        assistantId,
        expectedGen: gen,
        snapshot: batch,
        initialLastEventId: batch.events[batch.events.length - 1]?.eventId ?? fromEventId,
      })

      if (streamGenRef.current === gen && !reconnectResult.aborted) {
        finalize(reconnectResult.error ? { error: true } : undefined)
      }
    },
    [fetchStreamBatch, attachToExistingStream, finalize]
  )

  const retryReconnect = useCallback(
    async (opts: {
      streamId: string
      assistantId: string
      gen: number
      initialSnapshot?: StreamSnapshot | null
    }): Promise<boolean> => {
      const { streamId, assistantId, gen, initialSnapshot } = opts

      for (let attempt = 0; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
        if (streamGenRef.current !== gen) return true
        if (abortControllerRef.current?.signal.aborted) return true

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
          setIsReconnecting(true)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          if (streamGenRef.current !== gen) return true
          if (abortControllerRef.current?.signal.aborted) return true
        }

        try {
          await resumeOrFinalize({
            streamId,
            assistantId,
            gen,
            fromEventId: lastEventIdRef.current,
            snapshot: attempt === 0 ? initialSnapshot : undefined,
            signal: abortControllerRef.current?.signal,
          })
          return true
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return true
          logger.warn('Reconnect attempt failed', {
            streamId,
            attempt: attempt + 1,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      logger.error('All reconnect attempts exhausted', {
        streamId,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })
      setIsReconnecting(false)
      return false
    },
    [resumeOrFinalize]
  )
  retryReconnectRef.current = retryReconnect

  const sendMessage = useCallback(
    async (message: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      if (!message.trim() || !workspaceId) return

      if (sendingRef.current) {
        const queued: QueuedMessage = {
          id: crypto.randomUUID(),
          content: message,
          fileAttachments,
          contexts,
        }
        setMessageQueue((prev) => [...prev, queued])
        return
      }

      const gen = ++streamGenRef.current

      setError(null)
      setIsSending(true)
      sendingRef.current = true

      const userMessageId = crypto.randomUUID()
      const assistantId = crypto.randomUUID()

      pendingUserMsgRef.current = { id: userMessageId, content: message }
      streamIdRef.current = userMessageId
      lastEventIdRef.current = 0
      clientExecutionStartedRef.current.clear()

      const storedAttachments: TaskStoredFileAttachment[] | undefined =
        fileAttachments && fileAttachments.length > 0
          ? fileAttachments.map((f) => ({
              id: f.id,
              key: f.key,
              filename: f.filename,
              media_type: f.media_type,
              size: f.size,
            }))
          : undefined

      const requestChatId = selectedChatIdRef.current ?? chatIdRef.current
      const previousChatHistory = requestChatId
        ? queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(requestChatId))
        : undefined
      if (requestChatId) {
        const cachedUserMsg: TaskStoredMessage = {
          id: userMessageId,
          role: 'user' as const,
          content: message,
          ...(storedAttachments && { fileAttachments: storedAttachments }),
        }
        queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(requestChatId), (old) => {
          return old
            ? {
                ...old,
                messages: [...old.messages, cachedUserMsg],
                activeStreamId: userMessageId,
              }
            : undefined
        })
      }

      const userAttachments = storedAttachments?.map(toDisplayAttachment)
      const previousMessages = messagesRef.current

      const messageContexts = contexts?.map((c) => ({
        kind: c.kind,
        label: c.label,
        ...('workflowId' in c && c.workflowId ? { workflowId: c.workflowId } : {}),
        ...('knowledgeId' in c && c.knowledgeId ? { knowledgeId: c.knowledgeId } : {}),
        ...('tableId' in c && c.tableId ? { tableId: c.tableId } : {}),
        ...('fileId' in c && c.fileId ? { fileId: c.fileId } : {}),
      }))

      setMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: 'user',
          content: message,
          attachments: userAttachments,
          ...(messageContexts && messageContexts.length > 0 ? { contexts: messageContexts } : {}),
        },
        { id: assistantId, role: 'assistant', content: '', contentBlocks: [] },
      ])

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        const currentActiveId = activeResourceIdRef.current
        const currentResources = resourcesRef.current
        const resourceAttachments =
          currentResources.length > 0
            ? currentResources.map((r) => ({
                type: r.type,
                id: r.id,
                title: r.title,
                active: r.id === currentActiveId,
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
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Request failed: ${response.status}`)
        }

        if (!response.body) throw new Error('No response body')

        const termination = await processSSEStream(response.body.getReader(), assistantId, {
          expectedGen: gen,
        })
        if (streamGenRef.current === gen) {
          if (termination.sawStreamError) {
            finalize({ error: true })
            return
          }

          await resumeOrFinalize({
            streamId: userMessageId,
            assistantId,
            gen,
            fromEventId: termination.lastEventId,
            signal: abortController.signal,
          })
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
        if (requestChatId && isActiveStreamConflictError(errorMessage)) {
          logger.info('Active stream conflict detected while sending message; reattaching', {
            chatId: requestChatId,
            attemptedStreamId: userMessageId,
          })

          if (previousChatHistory) {
            queryClient.setQueryData(taskKeys.detail(requestChatId), previousChatHistory)
          }
          setMessages(previousMessages)
          const queuedMessage: QueuedMessage = {
            id: crypto.randomUUID(),
            content: message,
            fileAttachments,
            contexts,
          }
          pendingRecoveryMessageRef.current = queuedMessage
          setPendingRecoveryMessage(queuedMessage)

          try {
            const pendingRecovery = await preparePendingStreamRecovery(requestChatId)
            if (!pendingRecovery) {
              setError(errorMessage)
              if (streamGenRef.current === gen) {
                finalize({ error: true })
              }
              return
            }

            streamIdRef.current = pendingRecovery.streamId
            lastEventIdRef.current =
              pendingRecovery.snapshot?.events?.[pendingRecovery.snapshot.events.length - 1]
                ?.eventId ?? 0

            const rehydratedMessages = messagesRef.current
            const lastAssistantMsg = [...rehydratedMessages]
              .reverse()
              .find((m) => m.role === 'assistant')
            const recoveryAssistantId = lastAssistantMsg?.id ?? assistantId

            await resumeOrFinalize({
              streamId: pendingRecovery.streamId,
              assistantId: recoveryAssistantId,
              gen,
              fromEventId: lastEventIdRef.current,
              snapshot: pendingRecovery.snapshot,
            })
            return
          } catch (recoveryError) {
            logger.warn('Failed to recover active stream after conflict', {
              chatId: requestChatId,
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            })
          }
        }

        const activeStreamId = streamIdRef.current
        if (activeStreamId && streamGenRef.current === gen) {
          const succeeded = await retryReconnect({
            streamId: activeStreamId,
            assistantId,
            gen,
          })
          if (succeeded) return
        }

        setError(errorMessage)
        if (streamGenRef.current === gen) {
          finalize({ error: true })
        }
        return
      }
    },
    [
      workspaceId,
      queryClient,
      processSSEStream,
      finalize,
      resumeOrFinalize,
      retryReconnect,
      preparePendingStreamRecovery,
    ]
  )
  sendMessageRef.current = sendMessage

  const stopGeneration = useCallback(async () => {
    const wasSending = sendingRef.current
    const sid =
      streamIdRef.current ||
      queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(chatIdRef.current))
        ?.activeStreamId ||
      undefined

    streamGenRef.current++
    streamReaderRef.current?.cancel().catch(() => {})
    streamReaderRef.current = null
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    sendingRef.current = false
    setIsSending(false)
    setIsReconnecting(false)
    lastEventIdRef.current = 0
    pendingRecoveryMessageRef.current = null
    setPendingRecoveryMessage(null)

    setMessages((prev) =>
      prev.map((msg) => {
        if (!msg.contentBlocks?.some((b) => b.toolCall?.status === 'executing')) return msg
        const updated = msg.contentBlocks!.map((block) => {
          if (block.toolCall?.status !== 'executing') return block
          return {
            ...block,
            toolCall: {
              ...block.toolCall,
              status: 'cancelled' as const,
              displayTitle: 'Stopped by user',
            },
          }
        })
        updated.push({ type: 'stopped' as const })
        return { ...msg, contentBlocks: updated }
      })
    )

    if (sid) {
      fetch('/api/copilot/chat/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: sid }),
      }).catch(() => {})
    }

    if (wasSending && !chatIdRef.current) {
      const start = Date.now()
      while (!chatIdRef.current && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50))
      }
    }

    if (wasSending && chatIdRef.current) {
      await persistPartialResponse()
    }
    invalidateChatQueries()
    setStreamingFile(null)
    streamingFileRef.current = null
    setResources((rs) => rs.filter((resource) => resource.id !== 'streaming-file'))

    const execState = useExecutionStore.getState()
    const consoleStore = useTerminalConsoleStore.getState()
    for (const [workflowId, wfExec] of execState.workflowExecutions) {
      if (!wfExec.isExecuting) continue

      const toolCallId = markRunToolManuallyStopped(workflowId)
      cancelRunToolExecution(workflowId)

      const executionId = execState.getCurrentExecutionId(workflowId)
      if (executionId) {
        execState.setCurrentExecutionId(workflowId, null)
        fetch(`/api/workflows/${workflowId}/executions/${executionId}/cancel`, {
          method: 'POST',
        }).catch(() => {})
      }

      consoleStore.cancelRunningEntries(workflowId)
      const now = new Date()
      consoleStore.addConsole({
        input: {},
        output: {},
        success: false,
        error: 'Execution was cancelled',
        durationMs: 0,
        startedAt: now.toISOString(),
        executionOrder: Number.MAX_SAFE_INTEGER,
        endedAt: now.toISOString(),
        workflowId,
        blockId: 'cancelled',
        executionId: executionId ?? undefined,
        blockName: 'Execution Cancelled',
        blockType: 'cancelled',
      })

      executionStream.cancel(workflowId)
      consolePersistence.executionEnded()
      execState.setIsExecuting(workflowId, false)
      execState.setIsDebugging(workflowId, false)
      execState.setActiveBlocks(workflowId, new Set())

      reportManualRunToolStop(workflowId, toolCallId).catch(() => {})
    }
  }, [invalidateChatQueries, persistPartialResponse, executionStream])

  const removeFromQueue = useCallback((id: string) => {
    if (pendingRecoveryMessageRef.current?.id === id) {
      pendingRecoveryMessageRef.current = null
      setPendingRecoveryMessage(null)
      return
    }
    messageQueueRef.current = messageQueueRef.current.filter((m) => m.id !== id)
    setMessageQueue((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const sendNow = useCallback(
    async (id: string) => {
      const recoveryMessage = pendingRecoveryMessageRef.current
      const msg =
        recoveryMessage?.id === id
          ? recoveryMessage
          : messageQueueRef.current.find((m) => m.id === id)
      if (!msg) return
      // Eagerly update ref so a rapid second click finds the message already gone
      if (recoveryMessage?.id === id) {
        pendingRecoveryMessageRef.current = null
        setPendingRecoveryMessage(null)
      } else {
        messageQueueRef.current = messageQueueRef.current.filter((m) => m.id !== id)
      }
      await stopGeneration()
      if (recoveryMessage?.id !== id) {
        setMessageQueue((prev) => prev.filter((m) => m.id !== id))
      }
      await sendMessage(msg.content, msg.fileAttachments, msg.contexts)
    },
    [stopGeneration, sendMessage]
  )

  const editQueuedMessage = useCallback((id: string): QueuedMessage | undefined => {
    const recoveryMessage = pendingRecoveryMessageRef.current
    if (recoveryMessage?.id === id) {
      pendingRecoveryMessageRef.current = null
      setPendingRecoveryMessage(null)
      return recoveryMessage
    }

    const msg = messageQueueRef.current.find((m) => m.id === id)
    if (!msg) return undefined
    messageQueueRef.current = messageQueueRef.current.filter((m) => m.id !== id)
    setMessageQueue((prev) => prev.filter((m) => m.id !== id))
    return msg
  }, [])

  useEffect(() => {
    return () => {
      streamReaderRef.current = null
      abortControllerRef.current = null
      streamGenRef.current++
      sendingRef.current = false
      lastEventIdRef.current = 0
      clientExecutionStartedRef.current.clear()
      pendingRecoveryMessageRef.current = null
    }
  }, [])

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
    messageQueue: visibleMessageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    streamingFile,
    genericResourceData,
  }
}
