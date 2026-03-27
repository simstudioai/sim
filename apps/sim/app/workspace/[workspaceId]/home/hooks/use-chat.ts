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
import { COPILOT_CHAT_API_PATH, MOTHERSHIP_CHAT_API_PATH } from '@/lib/copilot/constants'
import type { MothershipStreamV1EventEnvelope } from '@/lib/copilot/generated/mothership-stream-v1'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ResourceOp,
  MothershipStreamV1RunKind,
  MothershipStreamV1SessionKind,
  MothershipStreamV1SpanLifecycleEvent,
  MothershipStreamV1SpanPayloadKind,
  MothershipStreamV1ToolOutcome,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  DeployApi,
  DeployChat,
  DeployMcp,
  FileWrite,
  Read as ReadTool,
  Redeploy,
  ToolSearchToolRegex,
  WorkspaceFile,
} from '@/lib/copilot/generated/tool-catalog-v1'
import {
  extractResourcesFromToolResult,
  isResourceToolName,
} from '@/lib/copilot/resources/extraction'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resources/types'
import { isWorkflowToolName } from '@/lib/copilot/tools/workflow-tools'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import type {
  ChatMessage,
  ChatMessageAttachment,
  ContentBlock,
  ContentBlockType,
  FileAttachmentForApi,
  MothershipResource,
  MothershipResourceType,
  QueuedMessage,
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
}

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  [MothershipStreamV1ToolOutcome.success]: 'success',
  [MothershipStreamV1ToolOutcome.error]: 'error',
  [MothershipStreamV1ToolOutcome.cancelled]: 'cancelled',
  [MothershipStreamV1ToolOutcome.rejected]: 'error',
  [MothershipStreamV1ToolOutcome.skipped]: 'success',
} as const

const DEPLOY_TOOL_NAMES: Set<string> = new Set([
  DeployApi.id,
  DeployChat.id,
  DeployMcp.id,
  Redeploy.id,
])
const RECONNECT_TAIL_ERROR =
  'Live reconnect failed before the stream finished. The latest response may be incomplete.'

function mapStoredBlock(block: TaskStoredContentBlock): ContentBlock {
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

type StreamPayload = Record<string, unknown>

type StreamToolUI = {
  hidden?: boolean
  title?: string
  phaseLabel?: string
  clientExecutable?: boolean
}

function asPayloadRecord(value: unknown): StreamPayload | undefined {
  return value && typeof value === 'object' ? (value as StreamPayload) : undefined
}

function getPayloadData(event: MothershipStreamV1EventEnvelope): StreamPayload {
  return asPayloadRecord(event.payload) ?? {}
}

function getToolUI(payload: StreamPayload): StreamToolUI | undefined {
  const raw = asPayloadRecord(payload.ui)
  if (!raw) {
    return undefined
  }

  return {
    ...(typeof raw.hidden === 'boolean' ? { hidden: raw.hidden } : {}),
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(typeof raw.phaseLabel === 'string' ? { phaseLabel: raw.phaseLabel } : {}),
    ...(typeof raw.clientExecutable === 'boolean'
      ? { clientExecutable: raw.clientExecutable }
      : {}),
  }
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
}

export function getMothershipUseChatOptions(
  options: Pick<UseChatOptions, 'onResourceEvent' | 'onStreamEnd'> = {}
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

  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
  const messageQueueRef = useRef<QueuedMessage[]>([])
  messageQueueRef.current = messageQueue

  const sendMessageRef = useRef<UseChatReturn['sendMessage']>(async () => {})
  const processSSEStreamRef = useRef<
    (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number
    ) => Promise<boolean>
  >(async () => false)
  const finalizeRef = useRef<(options?: { error?: boolean }) => void>(() => {})

  const abortControllerRef = useRef<AbortController | null>(null)
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  /** Panel/task selection — drives createNewChat + request chatId; may differ from chatIdRef while a stream is still finishing. */
  const selectedChatIdRef = useRef<string | undefined>(initialChatId)
  selectedChatIdRef.current = initialChatId
  const appliedChatIdRef = useRef<string | undefined>(undefined)
  const pendingUserMsgRef = useRef<{ id: string; content: string } | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  const lastCursorRef = useRef('0')
  const sendingRef = useRef(false)
  const streamGenRef = useRef(0)
  const streamingContentRef = useRef('')
  const streamingBlocksRef = useRef<ContentBlock[]>([])
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

    if (resource.id === 'streaming-file') {
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
    lastCursorRef.current = '0'
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
    setMessageQueue([])
  }, [initialChatId, queryClient])

  useEffect(() => {
    if (workflowIdRef.current) return
    if (!isHomePage || !chatIdRef.current) return
    streamGenRef.current++
    chatIdRef.current = undefined
    lastCursorRef.current = '0'
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
    setMessageQueue([])
  }, [isHomePage])

  useEffect(() => {
    if (!chatHistory || appliedChatIdRef.current === chatHistory.id) return

    const activeStreamId = chatHistory.activeStreamId
    appliedChatIdRef.current = chatHistory.id
    const mappedMessages = chatHistory.messages.map(mapStoredMessage)
    const shouldPreserveActiveStreamingMessage =
      sendingRef.current && Boolean(activeStreamId) && activeStreamId === streamIdRef.current

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

    if (chatHistory.resources.some((r) => r.id === 'streaming-file')) {
      fetch('/api/copilot/chat/resources', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chatHistory.id,
          resourceType: 'file',
          resourceId: 'streaming-file',
        }),
      }).catch(() => {})
    }

    const persistedResources = chatHistory.resources.filter((r) => r.id !== 'streaming-file')
    if (persistedResources.length > 0) {
      setResources(persistedResources)
      setActiveResourceId(persistedResources[persistedResources.length - 1].id)

      for (const resource of persistedResources) {
        if (resource.type !== 'workflow') continue
        ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
      }
    } else if (chatHistory.resources.some((r) => r.id === 'streaming-file')) {
      setResources([])
      setActiveResourceId(null)
    }

    if (activeStreamId && !sendingRef.current) {
      const gen = ++streamGenRef.current
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      streamIdRef.current = activeStreamId
      sendingRef.current = true
      setIsReconnecting(true)

      const assistantId = crypto.randomUUID()

      const reconnect = async () => {
        let reconnectFailed = false
        try {
          setIsSending(true)
          setIsReconnecting(false)
          const resumeAfter = lastCursorRef.current || '0'
          const sseRes = await fetch(
            `/api/copilot/chat/stream?streamId=${activeStreamId}&after=${encodeURIComponent(resumeAfter)}`,
            { signal: abortController.signal }
          )
          if (!sseRes.ok || !sseRes.body) {
            reconnectFailed = true
            logger.warn('Recovery SSE returned no readable body', {
              status: sseRes.status,
              streamId: activeStreamId,
            })
            setError(RECONNECT_TAIL_ERROR)
            return
          }

          const hadStreamError = await processSSEStreamRef.current(
            sseRes.body.getReader(),
            assistantId,
            gen
          )
          if (hadStreamError) {
            reconnectFailed = true
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
          reconnectFailed = true
        } finally {
          setIsReconnecting(false)
          if (streamGenRef.current === gen) {
            finalizeRef.current(reconnectFailed ? { error: true } : undefined)
          }
        }
      }
      reconnect()
    }
  }, [chatHistory, workspaceId, queryClient])

  const processSSEStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number
    ) => {
      const decoder = new TextDecoder()
      streamReaderRef.current = reader
      let buffer = ''
      const blocks: ContentBlock[] = []
      const toolMap = new Map<string, number>()
      const toolArgsMap = new Map<string, Record<string, unknown>>()
      const clientExecutionStarted = new Set<string>()
      let activeSubagent: string | undefined
      let activeCompactionId: string | undefined
      let runningText = ''
      let lastContentSource: 'main' | 'subagent' | null = null
      let streamRequestId: string | undefined

      streamingContentRef.current = ''
      streamingBlocksRef.current = []

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

      const buildInlineErrorTag = (event: MothershipStreamV1EventEnvelope) => {
        const data = getPayloadData(event)
        const message =
          (typeof data.displayMessage === 'string' ? data.displayMessage : undefined) ||
          (typeof data.message === 'string' ? data.message : undefined) ||
          (typeof data.error === 'string' ? data.error : undefined) ||
          'An unexpected error occurred'
        const provider = typeof data.provider === 'string' ? data.provider : undefined
        const code = typeof data.code === 'string' ? data.code : undefined
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

            let parsed: MothershipStreamV1EventEnvelope
            try {
              parsed = JSON.parse(raw)
            } catch {
              continue
            }

            if (parsed.trace?.requestId && parsed.trace.requestId !== streamRequestId) {
              streamRequestId = parsed.trace.requestId
              flush()
            }
            if (parsed.stream?.streamId) {
              streamIdRef.current = parsed.stream.streamId
            }
            if (parsed.stream?.cursor) {
              lastCursorRef.current = parsed.stream.cursor
            } else if (typeof parsed.seq === 'number') {
              lastCursorRef.current = String(parsed.seq)
            }

            logger.debug('SSE event received', parsed)
            switch (parsed.type) {
              case MothershipStreamV1EventType.session: {
                const payload = getPayloadData(parsed)
                const kind = typeof payload.kind === 'string' ? payload.kind : ''
                const payloadChatId =
                  typeof payload.chatId === 'string'
                    ? payload.chatId
                    : typeof parsed.stream?.chatId === 'string'
                      ? parsed.stream.chatId
                      : undefined
                if (kind === MothershipStreamV1SessionKind.chat && payloadChatId) {
                  const isNewChat = !chatIdRef.current
                  chatIdRef.current = payloadChatId
                  const selected = selectedChatIdRef.current
                  if (selected == null) {
                    if (isNewChat) {
                      setResolvedChatId(payloadChatId)
                    }
                  } else if (payloadChatId === selected) {
                    setResolvedChatId(payloadChatId)
                  }
                  queryClient.invalidateQueries({
                    queryKey: taskKeys.list(workspaceId),
                  })
                  if (isNewChat) {
                    const userMsg = pendingUserMsgRef.current
                    const activeStreamId = streamIdRef.current
                    if (userMsg && activeStreamId) {
                      queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(payloadChatId), {
                        id: payloadChatId,
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
                        `/workspace/${workspaceId}/task/${payloadChatId}`
                      )
                    }
                  }
                }
                if (kind === MothershipStreamV1SessionKind.title) {
                  queryClient.invalidateQueries({
                    queryKey: taskKeys.list(workspaceId),
                  })
                  onTitleUpdateRef.current?.()
                }
                break
              }
              case MothershipStreamV1EventType.text: {
                const payload = getPayloadData(parsed)
                const chunk = typeof payload.text === 'string' ? payload.text : ''
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
              case MothershipStreamV1EventType.tool: {
                const payload = getPayloadData(parsed)
                const phase =
                  typeof payload.phase === 'string'
                    ? payload.phase
                    : MothershipStreamV1ToolPhase.call
                const id =
                  typeof payload.toolCallId === 'string'
                    ? payload.toolCallId
                    : typeof payload.id === 'string'
                      ? payload.id
                      : undefined
                if (!id) break

                if (phase === MothershipStreamV1ToolPhase.args_delta) {
                  const delta =
                    typeof payload.argumentsDelta === 'string' ? payload.argumentsDelta : ''
                  if (!delta) break

                  const toolName =
                    typeof payload.toolName === 'string'
                      ? payload.toolName
                      : (blocks[toolMap.get(id) ?? -1]?.toolCall?.name ?? '')
                  const streamWorkspaceFile =
                    activeSubagent === FileWrite.id || toolName === WorkspaceFile.id

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
                      const match = raw.match(/"fileName"\s*:\s*"([^"]+)"/)
                      if (match) {
                        fileName = match[1]
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
                      setResources((rs) =>
                        rs.filter((resource) => resource.id !== 'streaming-file')
                      )
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
                  break
                }

                if (phase === MothershipStreamV1ToolPhase.result) {
                  const idx = toolMap.get(id)
                  if (idx === undefined || !blocks[idx].toolCall) {
                    break
                  }
                  const tc = blocks[idx].toolCall!
                  const resultObj = asPayloadRecord(payload.result)
                  const success =
                    typeof payload.success === 'boolean'
                      ? payload.success
                      : payload.status === MothershipStreamV1ToolOutcome.success
                  const isCancelled =
                    resultObj?.reason === 'user_cancelled' ||
                    resultObj?.cancelledByUser === true ||
                    payload.reason === 'user_cancelled' ||
                    payload.cancelledByUser === true ||
                    payload.status === MothershipStreamV1ToolOutcome.cancelled

                  if (isCancelled) {
                    tc.status = 'cancelled'
                    tc.displayTitle = 'Stopped by user'
                  } else {
                    tc.status = success ? 'success' : 'error'
                  }
                  tc.streamingArgs = undefined
                  tc.result = {
                    success: !!success,
                    output:
                      payload.result !== undefined
                        ? payload.result
                        : payload.output !== undefined
                          ? payload.output
                          : payload.data,
                    error: typeof payload.error === 'string' ? payload.error : undefined,
                  }
                  flush()

                  if (tc.name === ReadTool.id && tc.status === 'success') {
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
                      const isDeployed = output.isDeployed as boolean
                      const serverDeployedAt = output.deployedAt
                        ? new Date(output.deployedAt as string)
                        : undefined
                      useWorkflowRegistry
                        .getState()
                        .setDeploymentStatus(
                          deployedWorkflowId,
                          isDeployed,
                          isDeployed ? (serverDeployedAt ?? new Date()) : undefined
                        )
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

                  if (tc.name === WorkspaceFile.id) {
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

                  if (tc.status === 'error' && tc.name === WorkspaceFile.id) {
                    setStreamingFile(null)
                    streamingFileRef.current = null
                    setResources((rs) => rs.filter((resource) => resource.id !== 'streaming-file'))
                  }
                  break
                }

                const name =
                  typeof payload.toolName === 'string'
                    ? payload.toolName
                    : typeof payload.name === 'string'
                      ? payload.name
                      : 'unknown'
                const isPartial = payload.partial === true
                if (name === ToolSearchToolRegex.id) {
                  break
                }
                const ui = getToolUI(payload)
                if (ui?.hidden) break
                const displayTitle = ui?.title || ui?.phaseLabel
                const phaseLabel = ui?.phaseLabel
                const args = (asPayloadRecord(payload.arguments) ??
                  asPayloadRecord(payload.input)) as Record<string, unknown> | undefined

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
                  if (name === ReadTool.id || isResourceToolName(name)) {
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

                if (
                  ui?.clientExecutable &&
                  isWorkflowToolName(name) &&
                  !isPartial &&
                  !clientExecutionStarted.has(id)
                ) {
                  clientExecutionStarted.add(id)
                  const toolArgs = args ?? {}
                  const targetWorkflowId =
                    typeof toolArgs.workflowId === 'string'
                      ? toolArgs.workflowId
                      : useWorkflowRegistry.getState().activeWorkflowId
                  if (targetWorkflowId) {
                    const meta = useWorkflowRegistry.getState().workflows[targetWorkflowId]
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
                  executeRunToolOnClient(id, name, toolArgs)
                }
                break
              }
              case MothershipStreamV1EventType.resource: {
                const payload = getPayloadData(parsed)
                const resource = asPayloadRecord(payload.resource)
                if (
                  !resource ||
                  typeof resource.type !== 'string' ||
                  typeof resource.id !== 'string'
                ) {
                  break
                }

                if (payload.op === MothershipStreamV1ResourceOp.remove) {
                  removeResource(resource.type as MothershipResourceType, resource.id)
                  invalidateResourceQueries(
                    queryClient,
                    workspaceId,
                    resource.type as MothershipResourceType,
                    resource.id
                  )
                  onResourceEventRef.current?.()
                  break
                }

                const nextResource = {
                  type: resource.type as MothershipResourceType,
                  id: resource.id,
                  title: typeof resource.title === 'string' ? resource.title : resource.id,
                }
                const wasAdded = addResource(nextResource)
                invalidateResourceQueries(
                  queryClient,
                  workspaceId,
                  nextResource.type,
                  nextResource.id
                )

                if (!wasAdded && activeResourceIdRef.current !== nextResource.id) {
                  setActiveResourceId(nextResource.id)
                }
                onResourceEventRef.current?.()

                if (nextResource.type === 'workflow') {
                  const wasRegistered = ensureWorkflowInRegistry(
                    nextResource.id,
                    nextResource.title,
                    workspaceId
                  )
                  if (wasAdded && wasRegistered) {
                    useWorkflowRegistry.getState().setActiveWorkflow(nextResource.id)
                  } else {
                    useWorkflowRegistry.getState().loadWorkflowState(nextResource.id)
                  }
                }
                break
              }
              case MothershipStreamV1EventType.run: {
                const payload = getPayloadData(parsed)
                const kind = typeof payload.kind === 'string' ? payload.kind : ''
                if (kind === MothershipStreamV1RunKind.compaction_start) {
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
                } else if (kind === MothershipStreamV1RunKind.compaction_done) {
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
                }
                break
              }
              case MothershipStreamV1EventType.span: {
                const payload = getPayloadData(parsed)
                const kind = typeof payload.kind === 'string' ? payload.kind : ''
                if (kind !== MothershipStreamV1SpanPayloadKind.subagent) {
                  break
                }
                const spanEvent = typeof payload.event === 'string' ? payload.event : ''
                const name =
                  typeof payload.agent === 'string'
                    ? payload.agent
                    : typeof parsed.scope?.agentId === 'string'
                      ? parsed.scope.agentId
                      : undefined
                if (spanEvent === MothershipStreamV1SpanLifecycleEvent.start && name) {
                  activeSubagent = name
                  blocks.push({ type: 'subagent', content: name })
                  if (name === FileWrite.id) {
                    const emptyFile = { fileName: '', content: '' }
                    streamingFileRef.current = emptyFile
                    setStreamingFile(emptyFile)
                  }
                  flush()
                } else if (spanEvent === MothershipStreamV1SpanLifecycleEvent.end) {
                  activeSubagent = undefined
                  blocks.push({ type: 'subagent_end' })
                  flush()
                }
                break
              }
              case MothershipStreamV1EventType.error: {
                const payload = getPayloadData(parsed)
                sawStreamError = true
                setError(
                  (typeof payload.message === 'string' ? payload.message : undefined) ||
                    (typeof payload.error === 'string' ? payload.error : undefined) ||
                    'An error occurred'
                )
                appendInlineErrorTag(buildInlineErrorTag(parsed))
                break
              }
              case MothershipStreamV1EventType.complete: {
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
      return sawStreamError
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
            state: isCancelled ? MothershipStreamV1ToolOutcome.cancelled : block.toolCall.status,
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

  const finalize = useCallback(
    (options?: { error?: boolean }) => {
      sendingRef.current = false
      setIsSending(false)
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
      lastCursorRef.current = '0'

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

        const hadStreamError = await processSSEStream(response.body.getReader(), assistantId, gen)
        if (streamGenRef.current === gen) {
          finalize(hadStreamError ? { error: true } : undefined)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to send message')
        if (streamGenRef.current === gen) {
          finalize({ error: true })
        }
        return
      }
    },
    [workspaceId, queryClient, processSSEStream, finalize]
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
      execState.setIsExecuting(workflowId, false)
      execState.setIsDebugging(workflowId, false)
      execState.setActiveBlocks(workflowId, new Set())

      reportManualRunToolStop(workflowId, toolCallId).catch(() => {})
    }
  }, [invalidateChatQueries, persistPartialResponse, executionStream])

  const removeFromQueue = useCallback((id: string) => {
    messageQueueRef.current = messageQueueRef.current.filter((m) => m.id !== id)
    setMessageQueue((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const sendNow = useCallback(
    async (id: string) => {
      const msg = messageQueueRef.current.find((m) => m.id === id)
      if (!msg) return
      // Eagerly update ref so a rapid second click finds the message already gone
      messageQueueRef.current = messageQueueRef.current.filter((m) => m.id !== id)
      await stopGeneration()
      setMessageQueue((prev) => prev.filter((m) => m.id !== id))
      await sendMessage(msg.content, msg.fileAttachments, msg.contexts)
    },
    [stopGeneration, sendMessage]
  )

  const editQueuedMessage = useCallback((id: string): QueuedMessage | undefined => {
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
    messageQueue,
    removeFromQueue,
    sendNow,
    editQueuedMessage,
    streamingFile,
  }
}
