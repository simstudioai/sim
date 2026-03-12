import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { MOTHERSHIP_CHAT_API_PATH } from '@/lib/copilot/constants'
import { tableKeys, useTablesList } from '@/hooks/queries/tables'
import {
  type TaskChatHistory,
  type TaskStoredContentBlock,
  type TaskStoredFileAttachment,
  type TaskStoredMessage,
  type TaskStoredToolCall,
  taskKeys,
  useChatHistory,
} from '@/hooks/queries/tasks'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles, workspaceFilesKeys } from '@/hooks/queries/workspace-files'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { FileAttachmentForApi } from '../components/user-input/user-input'
import type {
  ChatMessage,
  ChatMessageAttachment,
  ContentBlock,
  ContentBlockType,
  MothershipResource,
  SSEPayload,
  SSEPayloadData,
  ToolCallStatus,
} from '../types'
import {
  extractFileResource,
  extractFunctionExecuteResource,
  extractResourcesFromHistory,
  extractTableResource,
  extractWorkflowResource,
  RESOURCE_TOOL_NAMES,
} from '../utils'

export interface UseChatReturn {
  messages: ChatMessage[]
  isSending: boolean
  error: string | null
  sendMessage: (message: string, fileAttachments?: FileAttachmentForApi[]) => Promise<void>
  stopGeneration: () => Promise<void>
  resources: MothershipResource[]
  activeResourceId: string | null
  setActiveResourceId: (id: string | null) => void
}

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  success: 'success',
  error: 'error',
} as const

function areResourcesEqual(left: MothershipResource[], right: MothershipResource[]): boolean {
  if (left.length !== right.length) return false
  return left.every(
    (resource, index) =>
      resource.id === right[index]?.id &&
      resource.type === right[index]?.type &&
      resource.title === right[index]?.title
  )
}

function sanitizeResources(
  resources: MothershipResource[],
  existingFileIds: Set<string>,
  existingTableIds: Set<string>,
  existingWorkflowIds: Set<string>,
  shouldFilterMissingFiles: boolean,
  shouldFilterMissingTables: boolean,
  shouldFilterMissingWorkflows: boolean
): MothershipResource[] {
  return resources.filter((resource) => {
    if (resource.type === 'file') {
      if (shouldFilterMissingFiles && !existingFileIds.has(resource.id)) {
        return false
      }
    }
    if (resource.type === 'table') {
      if (shouldFilterMissingTables && !existingTableIds.has(resource.id)) {
        return false
      }
    }
    if (resource.type === 'workflow') {
      if (shouldFilterMissingWorkflows && !existingWorkflowIds.has(resource.id)) {
        return false
      }
    }
    return true
  })
}

function mapStoredBlock(block: TaskStoredContentBlock): ContentBlock {
  const mapped: ContentBlock = {
    type: block.type as ContentBlockType,
    content: block.content,
  }

  if (block.type === 'tool_call' && block.toolCall) {
    mapped.toolCall = {
      id: block.toolCall.id ?? '',
      name: block.toolCall.name ?? 'unknown',
      status: STATE_TO_STATUS[block.toolCall.state ?? ''] ?? 'success',
      displayTitle: block.toolCall.display?.text,
      calledBy: block.toolCall.calledBy,
      result: block.toolCall.result,
    }
  }

  return mapped
}

function mapStoredToolCall(tc: TaskStoredToolCall): ContentBlock {
  return {
    type: 'tool_call',
    toolCall: {
      id: tc.id,
      name: tc.name,
      status: (STATE_TO_STATUS[tc.status] ?? 'success') as ToolCallStatus,
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

  return mapped
}

const logger = createLogger('useChat')

function getPayloadData(payload: SSEPayload): SSEPayloadData | undefined {
  return typeof payload.data === 'object' ? payload.data : undefined
}

export function useChat(workspaceId: string, initialChatId?: string): UseChatReturn {
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resources, setResources] = useState<MothershipResource[]>([])
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  const appliedChatIdRef = useRef<string | undefined>(undefined)
  const pendingUserMsgRef = useRef<{ id: string; content: string } | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  const sendingRef = useRef(false)
  const toolArgsMapRef = useRef<Map<string, Record<string, unknown>>>(new Map())
  const streamGenRef = useRef(0)
  const streamingContentRef = useRef('')

  const isHomePage = pathname.endsWith('/home')

  const { data: chatHistory } = useChatHistory(initialChatId)
  const {
    data: workspaceFiles = [],
    isLoading: isWorkspaceFilesLoading,
    isError: isWorkspaceFilesError,
  } = useWorkspaceFiles(workspaceId)
  const {
    data: workspaceTables = [],
    isLoading: isWorkspaceTablesLoading,
    isError: isWorkspaceTablesError,
  } = useTablesList(workspaceId)
  const {
    data: workflows = [],
    isLoading: isWorkflowsLoading,
    isError: isWorkflowsError,
  } = useWorkflows(workspaceId, { syncRegistry: false })

  const existingWorkspaceFileIds = useMemo(
    () => new Set(workspaceFiles.map((file) => file.id)),
    [workspaceFiles]
  )
  const existingWorkspaceTableIds = useMemo(
    () => new Set(workspaceTables.map((table) => table.id)),
    [workspaceTables]
  )
  const existingWorkflowIds = useMemo(() => new Set(workflows.map((workflow) => workflow.id)), [workflows])

  const addResource = useCallback((resource: MothershipResource) => {
    setResources((prev) => {
      const existing = prev.find((r) => r.type === resource.type && r.id === resource.id)
      if (existing) {
        const keepOldTitle = existing.title !== 'Table' && existing.title !== 'File'
        const title = keepOldTitle ? existing.title : resource.title
        if (title === existing.title) return prev
        return prev.map((r) =>
          r.id === existing.id && r.type === existing.type ? { ...r, title } : r
        )
      }
      return [...prev, resource]
    })
    setActiveResourceId(resource.id)
  }, [])

  useEffect(() => {
    if (sendingRef.current) {
      chatIdRef.current = initialChatId
      return
    }
    chatIdRef.current = initialChatId
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

    const restored = extractResourcesFromHistory(chatHistory.messages)
    if (restored.length > 0) {
      setResources(restored)
      setActiveResourceId(restored[restored.length - 1].id)

      for (const resource of restored) {
        if (resource.type !== 'workflow') continue
        const registry = useWorkflowRegistry.getState()
        if (!registry.workflows[resource.id]) {
          useWorkflowRegistry.setState((state) => ({
            workflows: {
              ...state.workflows,
              [resource.id]: {
                id: resource.id,
                name: resource.title,
                lastModified: new Date(),
                createdAt: new Date(),
                color: '#7F2FFF',
                workspaceId,
                folderId: null,
                sortOrder: 0,
              },
            },
          }))
        }
      }
    }
  }, [chatHistory, workspaceId])

  useEffect(() => {
    setResources((prev) => {
      const shouldFilterMissingFiles = !isWorkspaceFilesLoading && !isWorkspaceFilesError
      const shouldFilterMissingTables = !isWorkspaceTablesLoading && !isWorkspaceTablesError
      const shouldFilterMissingWorkflows = !isWorkflowsLoading && !isWorkflowsError
      const next = sanitizeResources(
        prev,
        existingWorkspaceFileIds,
        existingWorkspaceTableIds,
        existingWorkflowIds,
        shouldFilterMissingFiles,
        shouldFilterMissingTables,
        shouldFilterMissingWorkflows
      )
      return areResourcesEqual(prev, next) ? prev : next
    })
  }, [
    existingWorkspaceFileIds,
    existingWorkspaceTableIds,
    existingWorkflowIds,
    isWorkspaceFilesError,
    isWorkspaceFilesLoading,
    isWorkspaceTablesError,
    isWorkspaceTablesLoading,
    isWorkflowsError,
    isWorkflowsLoading,
  ])

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
      let activeSubagent: string | undefined
      let lastTableId: string | null = null
      let lastWorkflowId: string | null = null
      let runningText = ''

      streamingContentRef.current = ''
      toolArgsMapRef.current.clear()

      const ensureTextBlock = (): ContentBlock => {
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text') return last
        const b: ContentBlock = { type: 'text', content: '' }
        blocks.push(b)
        return b
      }

      const flush = () => {
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
                const tb = ensureTextBlock()
                tb.content = (tb.content ?? '') + chunk
                runningText += chunk
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
              if (!id) break

              if (RESOURCE_TOOL_NAMES.has(name)) {
                const args = data?.arguments ?? data?.input
                if (args) {
                  toolArgsMapRef.current.set(id, args)
                }
              }

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
              break
            }
            case 'tool_result': {
              const id = parsed.toolCallId || getPayloadData(parsed)?.id
              if (!id) break
              const idx = toolMap.get(id)
              if (idx !== undefined && blocks[idx].toolCall) {
                const tc = blocks[idx].toolCall!
                tc.status = parsed.success ? 'success' : 'error'
                tc.result = {
                  success: !!parsed.success,
                  output: parsed.result ?? getPayloadData(parsed)?.result,
                  error: (parsed.error ?? getPayloadData(parsed)?.error) as string | undefined,
                }
                flush()
              }

              const toolName = parsed.toolName || getPayloadData(parsed)?.name
              if (toolName && parsed.success && RESOURCE_TOOL_NAMES.has(toolName)) {
                const storedArgs = toolArgsMapRef.current.get(id)
                let resource: MothershipResource | null = null

                if (toolName === 'user_table') {
                  const redirected = extractFunctionExecuteResource(parsed, storedArgs)
                  if (redirected?.type === 'file') {
                    resource = redirected
                    queryClient.invalidateQueries({
                      queryKey: workspaceFilesKeys.list(workspaceId),
                    })
                    queryClient.invalidateQueries({
                      queryKey: workspaceFilesKeys.content(workspaceId, resource.id),
                    })
                  } else {
                    resource = extractTableResource(parsed, storedArgs, lastTableId)
                    if (resource) {
                      lastTableId = resource.id
                      queryClient.invalidateQueries({ queryKey: tableKeys.detail(resource.id) })
                      queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(resource.id) })
                    }
                  }
                } else if (toolName === 'workspace_file') {
                  resource = extractFileResource(parsed, storedArgs)
                  if (resource) {
                    queryClient.invalidateQueries({
                      queryKey: workspaceFilesKeys.list(workspaceId),
                    })
                    queryClient.invalidateQueries({
                      queryKey: workspaceFilesKeys.content(workspaceId, resource.id),
                    })
                  }
                } else if (toolName === 'function_execute') {
                  resource = extractFunctionExecuteResource(parsed, storedArgs)
                  if (resource) {
                    if (resource.type === 'table') {
                      lastTableId = resource.id
                      queryClient.invalidateQueries({ queryKey: tableKeys.detail(resource.id) })
                      queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(resource.id) })
                    } else if (resource.type === 'file') {
                      queryClient.invalidateQueries({
                        queryKey: workspaceFilesKeys.list(workspaceId),
                      })
                      queryClient.invalidateQueries({
                        queryKey: workspaceFilesKeys.content(workspaceId, resource.id),
                      })
                    }
                  }
                } else if (toolName === 'read') {
                  resource = extractFunctionExecuteResource(parsed, storedArgs)
                  if (resource?.type === 'table') {
                    lastTableId = resource.id
                    queryClient.invalidateQueries({ queryKey: tableKeys.detail(resource.id) })
                    queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(resource.id) })
                  }
                } else if (toolName === 'create_workflow' || toolName === 'edit_workflow') {
                  resource = extractWorkflowResource(parsed, lastWorkflowId)
                  if (resource) {
                    lastWorkflowId = resource.id
                    const registry = useWorkflowRegistry.getState()
                    if (!registry.workflows[resource.id]) {
                      useWorkflowRegistry.setState((state) => ({
                        workflows: {
                          ...state.workflows,
                          [resource!.id]: {
                            id: resource!.id,
                            name: resource!.title,
                            lastModified: new Date(),
                            createdAt: new Date(),
                            color: '#7F2FFF',
                            workspaceId,
                            folderId: null,
                            sortOrder: 0,
                          },
                        },
                      }))
                      registry.setActiveWorkflow(resource.id)
                    } else {
                      registry.loadWorkflowState(resource.id)
                    }
                  }
                }

                if (resource) addResource(resource)
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
    [workspaceId, queryClient, addResource]
  )

  const persistPartialResponse = useCallback(async () => {
    const chatId = chatIdRef.current
    const streamId = streamIdRef.current
    if (!chatId || !streamId) return

    const content = streamingContentRef.current
    try {
      const res = await fetch('/api/mothership/chat/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, streamId, content }),
      })
      if (res.ok) streamingContentRef.current = ''
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
    async (message: string, fileAttachments?: FileAttachmentForApi[]) => {
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

      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: 'user', content: message, attachments: userAttachments },
        { id: assistantId, role: 'assistant', content: '', contentBlocks: [] },
      ])

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
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
  }, [invalidateChatQueries, persistPartialResponse])

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
    sendMessage,
    stopGeneration,
    resources,
    activeResourceId,
    setActiveResourceId,
  }
}
