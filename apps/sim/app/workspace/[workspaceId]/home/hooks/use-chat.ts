import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { MOTHERSHIP_CHAT_API_PATH } from '@/lib/copilot/constants'
import { tableKeys } from '@/hooks/queries/tables'
import {
  type TaskChatHistory,
  type TaskStoredContentBlock,
  type TaskStoredMessage,
  type TaskStoredToolCall,
  taskKeys,
  useChatHistory,
} from '@/hooks/queries/tasks'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type {
  ChatMessage,
  ContentBlock,
  ContentBlockType,
  MothershipResource,
  SSEPayload,
  SSEPayloadData,
  ToolCallStatus,
} from '../types'
import { SUBAGENT_LABELS } from '../types'
import {
  extractFileResource,
  extractTableResource,
  extractWorkflowResource,
  RESOURCE_TOOL_NAMES,
} from '../utils'

export interface UseChatReturn {
  messages: ChatMessage[]
  isSending: boolean
  error: string | null
  sendMessage: (
    message: string,
    fileAttachments?: Array<{
      id: string
      key: string
      filename: string
      media_type: string
      size: number
    }>
  ) => Promise<void>
  stopGeneration: () => void
  chatBottomRef: React.RefObject<HTMLDivElement | null>
  resources: MothershipResource[]
  activeResourceId: string | null
  setActiveResourceId: (id: string | null) => void
}

const STATE_TO_STATUS: Record<string, ToolCallStatus> = {
  success: 'success',
  error: 'error',
} as const

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

function mapStoredMessage(msg: TaskStoredMessage): ChatMessage {
  const mapped: ChatMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
  }

  if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
    mapped.contentBlocks = msg.toolCalls.map(mapStoredToolCall)
  } else if (Array.isArray(msg.contentBlocks) && msg.contentBlocks.length > 0) {
    mapped.contentBlocks = msg.contentBlocks.map(mapStoredBlock)
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
  const router = useRouter()
  const routerRef = useRef(router)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resources, setResources] = useState<MothershipResource[]>([])
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const chatIdRef = useRef<string | undefined>(initialChatId)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const appliedChatIdRef = useRef<string | undefined>(undefined)
  const pendingUserMsgRef = useRef<{ id: string; content: string } | null>(null)
  const streamIdRef = useRef<string | undefined>(undefined)
  const sendingRef = useRef(false)
  const toolArgsMapRef = useRef<Map<string, Record<string, unknown>>>(new Map())

  useEffect(() => {
    routerRef.current = router
  }, [router])

  const isHomePage = pathname.endsWith('/home')

  const { data: chatHistory } = useChatHistory(initialChatId)

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
    chatIdRef.current = undefined
    appliedChatIdRef.current = undefined
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
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
  }, [chatHistory])

  const processSSEStream = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>, assistantId: string) => {
      const decoder = new TextDecoder()
      let buffer = ''
      const blocks: ContentBlock[] = []
      const toolMap = new Map<string, number>()
      let lastTableId: string | null = null
      let lastWorkflowId: string | null = null

      const ensureTextBlock = (): ContentBlock => {
        const last = blocks[blocks.length - 1]
        if (last?.type === 'text') return last
        const b: ContentBlock = { type: 'text', content: '' }
        blocks.push(b)
        return b
      }

      const flush = () => {
        const text = blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.content ?? '')
          .join('')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: text, contentBlocks: [...blocks] } : m
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
                  routerRef.current.replace(`/workspace/${workspaceId}/task/${parsed.chatId}`)
                }
              }
              break
            }
            case 'content': {
              const chunk = typeof parsed.data === 'string' ? parsed.data : (parsed.content ?? '')
              if (chunk) {
                const tb = ensureTextBlock()
                tb.content = (tb.content ?? '') + chunk
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

              const ui = parsed.ui || data?.ui
              if (ui?.hidden) break
              const displayTitle = ui?.title || ui?.phaseLabel
              if (!toolMap.has(id)) {
                toolMap.set(id, blocks.length)
                blocks.push({
                  type: 'tool_call',
                  toolCall: { id, name, status: 'executing', displayTitle },
                })
              } else {
                const idx = toolMap.get(id)!
                const tc = blocks[idx].toolCall
                if (tc) {
                  tc.name = name
                  if (displayTitle) tc.displayTitle = displayTitle
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
                  resource = extractTableResource(parsed, storedArgs, lastTableId)
                  if (resource) {
                    lastTableId = resource.id
                    queryClient.invalidateQueries({ queryKey: tableKeys.detail(resource.id) })
                    queryClient.invalidateQueries({ queryKey: tableKeys.rowsRoot(resource.id) })
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
                blocks.push({ type: 'subagent', content: SUBAGENT_LABELS[name] || name })
                flush()
              }
              break
            }
            case 'subagent_end': {
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

  const finalize = useCallback(() => {
    setIsSending(false)
    abortControllerRef.current = null
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })

    const activeChatId = chatIdRef.current
    if (activeChatId) {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(activeChatId) })
    }
    queryClient.invalidateQueries({ queryKey: taskKeys.list(workspaceId) })
  }, [workspaceId, queryClient])

  useEffect(() => {
    const activeStreamId = chatHistory?.activeStreamId
    if (!activeStreamId || !appliedChatIdRef.current || sendingRef.current) return

    const abortController = new AbortController()
    abortControllerRef.current = abortController
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
        finalize()
      }
    }
    reconnect()

    return () => {
      abortController.abort()
      appliedChatIdRef.current = undefined
    }
  }, [chatHistory?.activeStreamId, processSSEStream, finalize])

  const sendMessage = useCallback(
    async (
      message: string,
      fileAttachments?: Array<{
        id: string
        key: string
        filename: string
        media_type: string
        size: number
      }>
    ) => {
      if (!message.trim() || !workspaceId) return

      abortControllerRef.current?.abort()

      setError(null)
      setIsSending(true)
      sendingRef.current = true

      const userMessageId = crypto.randomUUID()
      const assistantId = crypto.randomUUID()

      pendingUserMsgRef.current = { id: userMessageId, content: message }
      streamIdRef.current = userMessageId

      if (chatIdRef.current) {
        queryClient.setQueryData<TaskChatHistory>(taskKeys.detail(chatIdRef.current), (old) =>
          old
            ? {
                ...old,
                messages: [
                  ...old.messages,
                  { id: userMessageId, role: 'user' as const, content: message },
                ],
                activeStreamId: userMessageId,
              }
            : undefined
        )
      }

      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: 'user', content: message },
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
        sendingRef.current = false
        finalize()
      }
    },
    [workspaceId, queryClient, processSSEStream, finalize]
  )

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsSending(false)
  }, [])

  return {
    messages,
    isSending,
    error,
    sendMessage,
    stopGeneration,
    chatBottomRef,
    resources,
    activeResourceId,
    setActiveResourceId,
  }
}
