import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import {
  executeRunToolOnClient,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/client-sse/run-tool-execution'
import { MOTHERSHIP_CHAT_API_PATH } from '@/lib/copilot/constants'
import {
  extractResourcesFromToolResult,
  isResourceToolName,
} from '@/lib/copilot/resource-extraction'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resource-types'
import { isWorkflowToolName } from '@/lib/copilot/workflow-tools'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import { deploymentKeys } from '@/hooks/queries/deployments'
import {
  type TaskChatHistory,
  type TaskStoredContentBlock,
  type TaskStoredFileAttachment,
  type TaskStoredMessage,
  type TaskStoredToolCall,
  taskKeys,
  useChatHistory,
} from '@/hooks/queries/tasks'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { workflowKeys } from '@/hooks/queries/workflows'
import { useExecutionStream } from '@/hooks/use-execution-stream'
import { useExecutionStore } from '@/stores/execution/store'
import { useFolderStore } from '@/stores/folders/store'
import type { ChatContext } from '@/stores/panel'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type {
  ChatMessage,
  ChatMessageAttachment,
  ContentBlock,
  ContentBlockType,
  FileAttachmentForApi,
  MothershipResource,
  MothershipResourceType,
  QueuedMessage,
  SSEPayload,
  SSEPayloadData,
  ToolCallStatus,
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
}

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  rejected: 'error',
  skipped: 'success',
} as const

const DEPLOY_TOOL_NAMES = new Set(['deploy_api', 'deploy_chat', 'deploy_mcp', 'redeploy'])

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

/** Adds a workflow to the registry with a top-insertion sort order if it doesn't already exist. */
function ensureWorkflowInRegistry(resourceId: string, title: string, workspaceId: string): boolean {
  const registry = useWorkflowRegistry.getState()
  if (registry.workflows[resourceId]) return false
  const sortOrder = getTopInsertionSortOrder(
    registry.workflows,
    useFolderStore.getState().folders,
    workspaceId,
    null
  )
  useWorkflowRegistry.setState((state) => ({
    workflows: {
      ...state.workflows,
      [resourceId]: {
        id: resourceId,
        name: title,
        lastModified: new Date(),
        createdAt: new Date(),
        color: getNextWorkflowColor(),
        workspaceId,
        folderId: null,
        sortOrder,
      },
    },
  }))
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

  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
  const messageQueueRef = useRef<QueuedMessage[]>([])
  messageQueueRef.current = messageQueue

  const sendMessageRef = useRef<UseChatReturn['sendMessage']>(async () => {})
  const processSSEStreamRef = useRef<
    (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      assistantId: string,
      expectedGen?: number
    ) => Promise<void>
  >(async () => {})
  const finalizeRef = useRef<(options?: { error?: boolean }) => void>(() => {})

  const abortControllerRef = useRef<AbortController | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  const appliedChatIdRef = useRef<string | undefined>(undefined)
  const pendingUserMsgRef = useRef<{ id: string; content: string } | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
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

    const currentChatId = chatIdRef.current
    if (currentChatId) {
      fetch('/api/copilot/chat/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: currentChatId, resource }),
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
      chatIdRef.current = initialChatId
      setResolvedChatId(initialChatId)
      setMessageQueue([])
      return
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
    setMessageQueue([])
  }, [initialChatId])

  useEffect(() => {
    if (!isHomePage || !chatIdRef.current) return
    streamGenRef.current++
    chatIdRef.current = undefined
    setResolvedChatId(undefined)
    appliedChatIdRef.current = undefined
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    sendingRef.current = false
    setMessages([])
    setError(null)
    setIsSending(false)
    setIsReconnecting(false)
    setResources([])
    setActiveResourceId(null)
    setMessageQueue([])
  }, [isHomePage])

  useEffect(() => {
    if (!chatHistory || appliedChatIdRef.current === chatHistory.id) return

    const activeStreamId = chatHistory.activeStreamId
    const snapshot = chatHistory.streamSnapshot

    if (activeStreamId && !snapshot && !sendingRef.current) {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(chatHistory.id) })
      return
    }

    appliedChatIdRef.current = chatHistory.id
    const mappedMessages = chatHistory.messages.map(mapStoredMessage)
    setMessages(mappedMessages)

    if (chatHistory.resources.length > 0) {
      setResources(chatHistory.resources)
      setActiveResourceId(chatHistory.resources[chatHistory.resources.length - 1].id)

      for (const resource of chatHistory.resources) {
        if (resource.type !== 'workflow') continue
        ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
      }
    }

    if (activeStreamId && !sendingRef.current) {
      abortControllerRef.current?.abort()
      const gen = ++streamGenRef.current
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      streamIdRef.current = activeStreamId
      sendingRef.current = true
      setIsReconnecting(true)

      const assistantId = crypto.randomUUID()

      const reconnect = async () => {
        try {
          const encoder = new TextEncoder()

          const batchEvents = snapshot?.events ?? []
          const streamStatus = snapshot?.status ?? ''

          if (batchEvents.length === 0 && streamStatus === 'unknown') {
            const cid = chatIdRef.current
            if (cid) {
              fetch('/api/mothership/chat/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: cid, streamId: activeStreamId, content: '' }),
              }).catch(() => {})
            }
            return
          }

          setIsSending(true)
          setIsReconnecting(false)

          const lastEventId =
            batchEvents.length > 0 ? batchEvents[batchEvents.length - 1].eventId : 0
          const isStreamDone = streamStatus === 'complete' || streamStatus === 'error'

          const combinedStream = new ReadableStream<Uint8Array>({
            async start(controller) {
              if (batchEvents.length > 0) {
                const sseText = batchEvents
                  .map((e) => `data: ${JSON.stringify(e.event)}\n`)
                  .join('\n')
                controller.enqueue(encoder.encode(`${sseText}\n`))
              }

              if (!isStreamDone) {
                try {
                  const sseRes = await fetch(
                    `/api/copilot/chat/stream?streamId=${activeStreamId}&from=${lastEventId}`,
                    { signal: abortController.signal }
                  )
                  if (sseRes.ok && sseRes.body) {
                    const reader = sseRes.body.getReader()
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break
                      controller.enqueue(value)
                    }
                  }
                } catch (err) {
                  if (!(err instanceof Error && err.name === 'AbortError')) {
                    logger.warn('SSE tail failed during reconnect', err)
                  }
                }
              }

              controller.close()
            },
          })

          await processSSEStreamRef.current(combinedStream.getReader(), assistantId, gen)
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
        } finally {
          setIsReconnecting(false)
          if (streamGenRef.current === gen) {
            finalizeRef.current()
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
      let buffer = ''
      const blocks: ContentBlock[] = []
      const toolMap = new Map<string, number>()
      const toolArgsMap = new Map<string, Record<string, unknown>>()
      const clientExecutionStarted = new Set<string>()
      let activeSubagent: string | undefined
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

      const isStale = () => expectedGen !== undefined && streamGenRef.current !== expectedGen

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

      while (true) {
        if (isStale()) {
          reader.cancel().catch(() => {})
          break
        }
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)

          let parsed: SSEPayload
          try {
            parsed = JSON.parse(raw)
          } catch {
            continue
          }

          logger.debug('SSE event received', parsed)
          switch (parsed.type) {
            case 'chat_id': {
              if (parsed.chatId) {
                const isNewChat = !chatIdRef.current
                chatIdRef.current = parsed.chatId
                setResolvedChatId(parsed.chatId)
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
                  window.history.replaceState(
                    null,
                    '',
                    `/workspace/${workspaceId}/task/${parsed.chatId}`
                  )
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
            case 'tool_generating':
            case 'tool_call': {
              const id = parsed.toolCallId
              const data = getPayloadData(parsed)
              const name = parsed.toolName || data?.name || 'unknown'
              const isPartial = data?.partial === true
              if (!id) break

              if (name.endsWith('_respond')) break
              const ui = parsed.ui || data?.ui
              if (ui?.hidden) break
              const displayTitle = ui?.title || ui?.phaseLabel
              const phaseLabel = ui?.phaseLabel
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
                    calledBy: activeSubagent,
                  },
                })
                if (name === 'read' || isResourceToolName(name)) {
                  const args = (data?.arguments ?? data?.input) as
                    | Record<string, unknown>
                    | undefined
                  if (args) toolArgsMap.set(id, args)
                }
              } else {
                const idx = toolMap.get(id)!
                const tc = blocks[idx].toolCall
                if (tc) {
                  tc.name = name
                  if (displayTitle) tc.displayTitle = displayTitle
                  if (phaseLabel) tc.phaseLabel = phaseLabel
                }
              }
              flush()

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
                executeRunToolOnClient(id, name, args as Record<string, unknown>)
              }
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

                if (tc.status === 'success' && isResourceToolName(tc.name)) {
                  const resources = extractResourcesFromToolResult(
                    tc.name,
                    toolArgsMap.get(id) as Record<string, unknown> | undefined,
                    tc.result?.output
                  )
                  for (const resource of resources) {
                    invalidateResourceQueries(queryClient, workspaceId, resource.type, resource.id)
                  }
                }
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
            case 'tool_error': {
              const id = parsed.toolCallId || getPayloadData(parsed)?.id
              if (!id) break
              const idx = toolMap.get(id)
              if (idx !== undefined && blocks[idx].toolCall) {
                blocks[idx].toolCall!.status = 'error'
                flush()
              }
              break
            }
            case 'subagent_start': {
              const name = parsed.subagent || getPayloadData(parsed)?.agent
              if (name) {
                activeSubagent = name
                blocks.push({ type: 'subagent', content: name })
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
              break
            }
            case 'error': {
              setError(parsed.error || 'An error occurred')
              break
            }
          }
        }
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
      const res = await fetch('/api/mothership/chat/stop', {
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

  const finalize = useCallback(
    (options?: { error?: boolean }) => {
      sendingRef.current = false
      setIsSending(false)
      abortControllerRef.current = null
      invalidateChatQueries()

      if (options?.error) {
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

      if (chatIdRef.current) {
        const cachedUserMsg: TaskStoredMessage = {
          id: userMessageId,
          role: 'user' as const,
          content: message,
          ...(storedAttachments && { fileAttachments: storedAttachments }),
        }
        queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatIdRef.current), (old) => {
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

        const response = await fetch(MOTHERSHIP_CHAT_API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            workspaceId,
            userMessageId,
            createNewChat: !chatIdRef.current,
            ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
            ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
            ...(resourceAttachments ? { resourceAttachments } : {}),
            ...(contexts && contexts.length > 0 ? { contexts } : {}),
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Request failed: ${response.status}`)
        }

        if (!response.body) throw new Error('No response body')

        await processSSEStream(response.body.getReader(), assistantId, gen)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to send message')
        if (streamGenRef.current === gen) {
          finalize({ error: true })
        }
        return
      }
      if (streamGenRef.current === gen) {
        finalize()
      }
    },
    [workspaceId, queryClient, processSSEStream, finalize]
  )
  sendMessageRef.current = sendMessage

  const stopGeneration = useCallback(async () => {
    if (sendingRef.current && !chatIdRef.current) {
      const start = Date.now()
      while (!chatIdRef.current && sendingRef.current && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (!chatIdRef.current) return
    }

    if (sendingRef.current) {
      await persistPartialResponse()
    }
    const sid =
      streamIdRef.current ||
      queryClient.getQueryData<TaskChatHistory>(taskKeys.detail(chatIdRef.current))
        ?.activeStreamId ||
      undefined
    streamGenRef.current++
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    sendingRef.current = false
    setIsSending(false)
    invalidateChatQueries()
    if (sid) {
      fetch('/api/copilot/chat/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId: sid }),
      }).catch(() => {})
    }

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

    const execState = useExecutionStore.getState()
    const consoleStore = useTerminalConsoleStore.getState()
    for (const [workflowId, wfExec] of execState.workflowExecutions) {
      if (!wfExec.isExecuting) continue

      markRunToolManuallyStopped(workflowId)

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

      reportManualRunToolStop(workflowId).catch(() => {})
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
      abortControllerRef.current?.abort()
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
  }
}
