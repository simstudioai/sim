'use client'

import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('useWorkspaceChat')

/** Status of a tool call as it progresses through execution. */
export type ToolCallStatus = 'executing' | 'success' | 'error'

/** Lightweight info about a single tool call rendered in the chat. */
export interface ToolCallInfo {
  id: string
  name: string
  status: ToolCallStatus
  /** Human-readable title from the backend ToolUI metadata. */
  displayTitle?: string
}

/** A content block inside an assistant message. */
export type ContentBlockType = 'text' | 'tool_call' | 'subagent'

export interface ContentBlock {
  type: ContentBlockType
  /** Text content (for 'text' and 'subagent' blocks). */
  content?: string
  /** Tool call info (for 'tool_call' blocks). */
  toolCall?: ToolCallInfo
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  /** Structured content blocks for rich rendering. When present, prefer over `content`. */
  contentBlocks?: ContentBlock[]
  /** Name of the currently active subagent (shown as a label while streaming). */
  activeSubagent?: string | null
}

interface UseWorkspaceChatProps {
  workspaceId: string
}

interface UseWorkspaceChatReturn {
  messages: ChatMessage[]
  isSending: boolean
  error: string | null
  sendMessage: (message: string) => Promise<void>
  abortMessage: () => void
  clearMessages: () => void
}

/** Maps subagent IDs to human-readable labels. */
const SUBAGENT_LABELS: Record<string, string> = {
  build: 'Building',
  deploy: 'Deploying',
  auth: 'Connecting credentials',
  research: 'Researching',
  knowledge: 'Managing knowledge base',
  custom_tool: 'Creating tool',
  superagent: 'Executing action',
  plan: 'Planning',
  debug: 'Debugging',
  edit: 'Editing workflow',
}

export function useWorkspaceChat({ workspaceId }: UseWorkspaceChatProps): UseWorkspaceChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const chatIdRef = useRef<string | undefined>(undefined)

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim() || !workspaceId) return

      setError(null)
      setIsSending(true)

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        contentBlocks: [],
        activeSubagent: null,
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      // Mutable refs for the streaming context so we can build content blocks
      // without relying on stale React state closures.
      const blocksRef: ContentBlock[] = []
      const toolCallMapRef = new Map<string, number>() // toolCallId → index in blocksRef

      /** Ensure the last block is a text block and return it. */
      const ensureTextBlock = (): ContentBlock => {
        const last = blocksRef[blocksRef.length - 1]
        if (last && last.type === 'text') return last
        const newBlock: ContentBlock = { type: 'text', content: '' }
        blocksRef.push(newBlock)
        return newBlock
      }

      /** Push updated blocks + content into the assistant message. */
      const flushBlocks = (extra?: Partial<ChatMessage>) => {
        const fullText = blocksRef
          .filter((b) => b.type === 'text')
          .map((b) => b.content ?? '')
          .join('')
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessage.id
              ? {
                  ...msg,
                  content: fullText,
                  contentBlocks: [...blocksRef],
                  ...extra,
                }
              : msg
          )
        )
      }

      try {
        const response = await fetch('/api/copilot/workspace-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            workspaceId,
            ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Request failed: ${response.status}`)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue

            try {
              const event = JSON.parse(line.slice(6))

              switch (event.type) {
                case 'chat_id': {
                  if (event.chatId) {
                    chatIdRef.current = event.chatId
                  }
                  break
                }

                case 'content': {
                  if (event.content || event.data) {
                    const chunk =
                      typeof event.data === 'string' ? event.data : event.content || ''
                    if (chunk) {
                      const textBlock = ensureTextBlock()
                      textBlock.content = (textBlock.content ?? '') + chunk
                      flushBlocks()
                    }
                  }
                  break
                }

                case 'tool_generating':
                case 'tool_call': {
                  const toolCallId = event.toolCallId
                  const toolName = event.toolName || event.data?.name || 'unknown'
                  if (!toolCallId) break

                  const ui = event.ui || event.data?.ui
                  const displayTitle = ui?.title || ui?.phaseLabel

                  if (!toolCallMapRef.has(toolCallId)) {
                    const toolBlock: ContentBlock = {
                      type: 'tool_call',
                      toolCall: {
                        id: toolCallId,
                        name: toolName,
                        status: 'executing',
                        displayTitle,
                      },
                    }
                    toolCallMapRef.set(toolCallId, blocksRef.length)
                    blocksRef.push(toolBlock)
                  } else {
                    const idx = toolCallMapRef.get(toolCallId)!
                    const existing = blocksRef[idx]
                    if (existing.toolCall) {
                      existing.toolCall.name = toolName
                      if (displayTitle) existing.toolCall.displayTitle = displayTitle
                    }
                  }
                  flushBlocks()
                  break
                }

                case 'tool_result': {
                  const toolCallId = event.toolCallId || event.data?.id
                  if (!toolCallId) break
                  const idx = toolCallMapRef.get(toolCallId)
                  if (idx !== undefined) {
                    const block = blocksRef[idx]
                    if (block.toolCall) {
                      block.toolCall.status = event.success ? 'success' : 'error'
                    }
                    flushBlocks()
                  }
                  break
                }

                case 'tool_error': {
                  const toolCallId = event.toolCallId || event.data?.id
                  if (!toolCallId) break
                  const idx = toolCallMapRef.get(toolCallId)
                  if (idx !== undefined) {
                    const block = blocksRef[idx]
                    if (block.toolCall) {
                      block.toolCall.status = 'error'
                    }
                    flushBlocks()
                  }
                  break
                }

                case 'subagent_start': {
                  const subagentName = event.subagent || event.data?.agent
                  if (subagentName) {
                    const label = SUBAGENT_LABELS[subagentName] || subagentName
                    const subBlock: ContentBlock = {
                      type: 'subagent',
                      content: label,
                    }
                    blocksRef.push(subBlock)
                    flushBlocks({ activeSubagent: label })
                  }
                  break
                }

                case 'subagent_end': {
                  flushBlocks({ activeSubagent: null })
                  break
                }

                case 'error': {
                  setError(event.error || 'An error occurred')
                  break
                }

                case 'done': {
                  if (event.content && typeof event.content === 'string') {
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessage.id && !msg.content
                          ? { ...msg, content: event.content }
                          : msg
                      )
                    )
                  }
                  break
                }
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          logger.info('Message aborted by user')
          return
        }

        const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
        logger.error('Failed to send workspace chat message', { error: errorMessage })
        setError(errorMessage)

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessage.id && !msg.content
              ? { ...msg, content: 'Sorry, something went wrong. Please try again.' }
              : msg
          )
        )
      } finally {
        setIsSending(false)
        abortControllerRef.current = null
      }
    },
    [workspaceId]
  )

  const abortMessage = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsSending(false)
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
    chatIdRef.current = undefined
  }, [])

  return {
    messages,
    isSending,
    error,
    sendMessage,
    abortMessage,
    clearMessages,
  }
}
