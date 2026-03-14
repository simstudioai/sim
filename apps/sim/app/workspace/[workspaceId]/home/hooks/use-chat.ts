import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import {
  executeRunToolOnClient,
  markRunToolManuallyStopped,
  reportManualRunToolStop,
} from '@/lib/copilot/client-sse/run-tool-execution'
import { MOTHERSHIP_CHAT_API_PATH } from '@/lib/copilot/constants'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resource-types'
import { isWorkflowToolName } from '@/lib/copilot/workflow-tools'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { invalidateResourceQueries } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
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
import { useExecutionStream } from '@/hooks/use-execution-stream'
import { useExecutionStore } from '@/stores/execution/store'
import { useFolderStore } from '@/stores/folders/store'
import type { ChatContext } from '@/stores/panel'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { FileAttachmentForApi } from '../components/user-input/user-input'
import type {
  ChatMessage,
  ChatMessageAttachment,
  ContentBlock,
  ContentBlockType,
  MothershipResource,
  MothershipResourceType,
  SSEPayload,
  SSEPayloadData,
  ToolCallStatus,
} from '../types'

export interface UseChatReturn {
  messages: ChatMessage[]
  isSending: boolean
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
}

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  rejected: 'error',
  skipped: 'success',
} as const

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
          ? { success: tc.status === 'success', output: tc.result, error: tc.error }
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
      ? `/api/files/serve/${encodeURIComponent(f.key)}?context=copilot`
      : undefined,
  }
}

function mapStoredMessage(msg: TaskStoredMessage): ChatMessage {
  const mapped: ChatMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
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
  const [error, setError] = useState<string | null>(null)
  const [resolvedChatId, setResolvedChatId] = useState<string | undefined>(initialChatId)
  const [resources, setResources] = useState<MothershipResource[]>([])
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null)
  const onResourceEventRef = useRef(options?.onResourceEvent)
  onResourceEventRef.current = options?.onResourceEvent
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources
  const activeResourceIdRef = useRef(activeResourceId)
  activeResourceIdRef.current = activeResourceId

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
      return
    }
    chatIdRef.current = initialChatId
    setResolvedChatId(initialChatId)
    appliedChatIdRef.current = undefined
    setMessages([])
    setError(null)
    setIsSending(false)
    setResources([])
    setActiveResourceId(null)
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
    setResources([])
    setActiveResourceId(null)
  }, [isHomePage])

  useEffect(() => {
    if (!chatHistory || appliedChatIdRef.current === chatHistory.id) return
    appliedChatIdRef.current = chatHistory.id
    setMessages(chatHistory.messages.map(mapStoredMessage))

    if (chatHistory.resources.length > 0) {
      setResources(chatHistory.resources)
      setActiveResourceId(chatHistory.resources[chatHistory.resources.length - 1].id)

      for (const resource of chatHistory.resources) {
        if (resource.type !== 'workflow') continue
        ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)
      }
    }
  }, [chatHistory, workspaceId])

  useEffect(() => {
    if (resources.length === 0) {
      if (activeResourceId !== null) {
        setActiveResourceId(null)
      }
      return
    }

    if (!activeResourceId || !resources.some((resource) => resource.id === activeResourceId)) {
      setActiveResourceId(resources[resources.length - 1].id)
    }
  }, [activeResourceId, resources])

  const processSSEStream = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>, assistantId: string) => {
      const decoder = new TextDecoder()
      let buffer = ''
      const blocks: ContentBlock[] = []
      const toolMap = new Map<string, number>()
      const toolArgsMap = new Map<string, Record<string, unknown>>()
      const clientExecutionStarted = new Set<string>()
      let activeSubagent: string | undefined
      let runningText = ''
      let lastContentSource: 'main' | 'subagent' | null = null

      streamingContentRef.current = ''
      streamingBlocksRef.current = []

      const ensureTextBlock = (): ContentBlock => {
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text') return last
        const b: ContentBlock = { type: 'text', content: '' }
        blocks.push(b)
        return b
      }

      const flush = () => {
        streamingBlocksRef.current = [...blocks]
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: runningText, contentBlocks: [...blocks] } : m
          )
        )
      }

      while (true) {
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
                queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
                if (isNewChat) {
                  const userMsg = pendingUserMsgRef.current
                  const activeStreamId = streamIdRef.current
                  if (userMsg && activeStreamId) {
                    queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(parsed.chatId), {
                      id: parsed.chatId,
                      title: null,
                      messages: [{ id: userMsg.id, role: 'user', content: userMsg.content }],
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
                if (name === 'read') {
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
                  if (resource) {
                    addResource(resource)
                    onResourceEventRef.current?.()
                  }
                }
              }

              break
            }
            case 'resource_added': {
              const resource = parsed.resource
              if (resource?.type && resource?.id) {
                addResource(resource)
                invalidateResourceQueries(queryClient, workspaceId, resource.type, resource.id)

                onResourceEventRef.current?.()
                if (resource.type === 'workflow') {
                  if (ensureWorkflowInRegistry(resource.id, resource.title, workspaceId)) {
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
              flush()
              break
            }
            case 'title_updated': {
              queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
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
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(activeChatId) })
    }
    queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
  }, [workspaceId, queryClient])

  const finalize = useCallback(() => {
    sendingRef.current = false
    setIsSending(false)
    abortControllerRef.current = null
    invalidateChatQueries()
  }, [invalidateChatQueries])

  useEffect(() => {
    const activeStreamId = chatHistory?.activeStreamId
    if (!activeStreamId || !appliedChatIdRef.current || sendingRef.current) return

    const gen = ++streamGenRef.current
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    sendingRef.current = true
    setIsSending(true)

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant' as const, content: '', contentBlocks: [] },
    ])

    const reconnect = async () => {
      try {
        const response = await fetch(`/api/copilot/chat/stream?streamId=${activeStreamId}&from=0`, {
          signal: abortController.signal,
        })
        if (!response.ok || !response.body) return
        await processSSEStream(response.body.getReader(), assistantId)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
      } finally {
        if (streamGenRef.current === gen) {
          finalize()
        }
      }
    }
    reconnect()

    return () => {
      abortController.abort()
      appliedChatIdRef.current = undefined
    }
  }, [chatHistory?.activeStreamId, processSSEStream, finalize])

  const sendMessage = useCallback(
    async (message: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      if (!message.trim() || !workspaceId) return

      if (sendingRef.current) {
        await persistPartialResponse()
      }
      abortControllerRef.current?.abort()

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
        queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatIdRef.current), (old) =>
          old
            ? {
                ...old,
                messages: [...old.messages, cachedUserMsg],
                activeStreamId: userMessageId,
              }
            : undefined
        )
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
        const activeRes = currentActiveId
          ? currentResources.find((r) => r.id === currentActiveId)
          : undefined
        const resourceAttachments = activeRes
          ? [{ type: activeRes.type, id: activeRes.id }]
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

        await processSSEStream(response.body.getReader(), assistantId)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to send message')
      } finally {
        if (streamGenRef.current === gen) {
          finalize()
        }
      }
    },
    [workspaceId, queryClient, processSSEStream, finalize, persistPartialResponse]
  )

  const stopGeneration = useCallback(async () => {
    if (sendingRef.current) {
      await persistPartialResponse()
    }
    const sid = streamIdRef.current
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

  useEffect(() => {
    return () => {
      streamGenRef.current++
      // Only drop the browser→Sim read; the Sim→Go stream stays open
      // so the backend can finish persisting. Explicit abort is only
      // triggered by the stop button via /api/copilot/chat/abort.
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      sendingRef.current = false
    }
  }, [])

  return {
    messages,
    isSending,
    error,
    resolvedChatId,
    sendMessage,
    stopGeneration,
    resources,
    activeResourceId,
    setActiveResourceId,
    addResource,
    removeResource,
    reorderResources,
  }
}
