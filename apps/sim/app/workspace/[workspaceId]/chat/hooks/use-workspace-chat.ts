'use client'

import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('useWorkspaceChat')

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
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
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])

      const abortController = new AbortController()
      abortControllerRef.current = abortController

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

              if (event.type === 'chat_id' && event.chatId) {
                chatIdRef.current = event.chatId
              } else if (event.type === 'content' && event.content) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, content: msg.content + event.content }
                      : msg
                  )
                )
              } else if (event.type === 'error') {
                setError(event.error || 'An error occurred')
              } else if (event.type === 'done') {
                if (event.content && typeof event.content === 'string') {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessage.id && !msg.content
                        ? { ...msg, content: event.content }
                        : msg
                    )
                  )
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
