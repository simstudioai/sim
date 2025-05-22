'use client'

import { useRef, useState } from 'react'
import { ChatMessage } from '../components/message/message'

export function useChatStreaming() {
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const stopStreaming = (setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>) => {
    if (abortControllerRef.current) {
      // Abort the fetch request
      abortControllerRef.current.abort()
      abortControllerRef.current = null

      // Add a message indicating the response was stopped
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1]

        // Only modify if the last message is from the assistant (as expected)
        if (lastMessage && lastMessage.type === 'assistant') {
          // Append a note that the response was stopped
          const updatedContent =
            lastMessage.content +
            (lastMessage.content
              ? '\n\n_Response stopped by user._'
              : '_Response stopped by user._')

          return [
            ...prev.slice(0, -1),
            { ...lastMessage, content: updatedContent, isStreaming: false },
          ]
        }

        return prev
      })

      // Reset streaming state
      setIsStreamingResponse(false)
    }
  }

  const handleStreamedResponse = async (
    response: Response,
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
    scrollToBottom: () => void,
    userHasScrolled?: boolean
  ) => {
    const messageId = crypto.randomUUID()

    // Set streaming state before adding the assistant message
    setIsStreamingResponse(true)

    // Add placeholder message
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        content: '',
        type: 'assistant',
        timestamp: new Date(),
        isStreaming: true,
      },
    ])

    // Stop showing loading indicator once streaming begins
    setIsLoading(false)

    // Ensure the response body exists and is a ReadableStream
    const reader = response.body?.getReader()
    if (reader) {
      const decoder = new TextDecoder()
      let done = false

      try {
        while (!done) {
          // Check if aborted before each read
          if (abortControllerRef.current === null) {
            console.log('Stream reading aborted')
            break
          }

          const { value, done: readerDone } = await reader.read()
          if (value) {
            const chunk = decoder.decode(value, { stream: true })
            if (chunk) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId ? { ...msg, content: msg.content + chunk } : msg
                )
              )
            }
          }
          done = readerDone
        }
      } catch (error) {
        console.error('Error reading stream:', error)
      } finally {
        // Always reset streaming state and controller when done
        setIsStreamingResponse(false)
        abortControllerRef.current = null

        // Remove isStreaming flag from the message
        setMessages((prev) =>
          prev.map((msg) => (msg.id === messageId ? { ...msg, isStreaming: false } : msg))
        )

        // Only scroll to bottom if user hasn't manually scrolled during streaming
        if (!userHasScrolled) {
          // Add a small delay before scrolling to bottom
          setTimeout(() => {
            scrollToBottom()
          }, 300)
        }
      }
    } else {
      setIsStreamingResponse(false)
      abortControllerRef.current = null

      // Remove isStreaming flag from the message
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, isStreaming: false } : msg))
      )

      // Only scroll to bottom if user hasn't manually scrolled
      if (!userHasScrolled) {
        setTimeout(() => {
          scrollToBottom()
        }, 300)
      }
    }
  }

  return {
    isStreamingResponse,
    setIsStreamingResponse,
    abortControllerRef,
    stopStreaming,
    handleStreamedResponse,
  }
}
