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

    // Helper function to clean up after streaming ends (success or error)
    const cleanupStreaming = (messageContent?: string, appendContent = false) => {
      // Reset streaming state and controller
      setIsStreamingResponse(false)
      abortControllerRef.current = null

      // Update message content and remove isStreaming flag
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            return {
              ...msg,
              content: appendContent
                ? msg.content + (messageContent || '')
                : messageContent || msg.content,
              isStreaming: false,
            }
          }
          return msg
        })
      )

      // Only scroll to bottom if user hasn't manually scrolled
      if (!userHasScrolled) {
        setTimeout(() => {
          scrollToBottom()
        }, 300)
      }
    }

    // Check if response body exists and is a ReadableStream
    if (!response.body) {
      cleanupStreaming("Error: Couldn't receive streaming response from server.")
      return
    }

    const reader = response.body.getReader()
    if (reader) {
      const decoder = new TextDecoder()
      let done = false

      try {
        while (!done) {
          // Check if aborted before awaiting reader.read()
          if (abortControllerRef.current === null) {
            console.log('Stream reading aborted')
            break
          }

          const { value, done: readerDone } = await reader.read()
          done = readerDone

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
        }
      } catch (error) {
        // Show error to user in the message
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error during streaming'
        console.error('Error reading stream:', error)
        cleanupStreaming(`\n\n_Error: ${errorMessage}_`, true)
        return // Skip the finally block's cleanupStreaming call
      } finally {
        // Don't call cleanupStreaming here if we already called it in the catch block
        if (abortControllerRef.current !== null) {
          cleanupStreaming()
        }
      }
    } else {
      cleanupStreaming("Error: Couldn't process streaming response.")
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
