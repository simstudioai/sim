'use client'

import { useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import type { ChatMessage } from '@/app/chat/[subdomain]/components/message/message'
// No longer need complex output extraction - backend handles this
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('UseChatStreaming')

export interface VoiceSettings {
  isVoiceEnabled: boolean
  voiceId: string
  autoPlayResponses: boolean
  voiceFirstMode?: boolean
  textStreamingInVoiceMode?: 'hidden' | 'synced' | 'normal'
  conversationMode?: boolean
}

export interface StreamingOptions {
  voiceSettings?: VoiceSettings
  onAudioStart?: () => void
  onAudioEnd?: () => void
  audioStreamHandler?: (text: string) => Promise<void>
}

export function useChatStreaming() {
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const accumulatedTextRef = useRef<Record<string, string>>({}) // per-block accumulation
  const lastStreamedPositionRef = useRef<Record<string, number>>({})
  const audioStreamingActiveRef = useRef<boolean>(false)
  const lastDisplayedPositionRef = useRef<number>(0) // Track displayed text in synced mode

  const stopStreaming = (setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>) => {
    if (abortControllerRef.current) {
      // Abort the fetch request
      abortControllerRef.current.abort()
      abortControllerRef.current = null

      // Add a message indicating the response was stopped (mark the latest assistant message)
      setMessages((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const msg = prev[i]
          if (msg.type === 'assistant' && msg.isStreaming) {
            const updatedContent =
              msg.content +
              (msg.content ? '\n\n_Response stopped by user._' : '_Response stopped by user._')
            return [
              ...prev.slice(0, i),
              { ...msg, content: updatedContent, isStreaming: false },
              ...prev.slice(i + 1),
            ]
          }
        }
        return prev
      })

      // Reset streaming state immediately
      setIsStreamingResponse(false)
      accumulatedTextRef.current = {}
      lastStreamedPositionRef.current = {}
      lastDisplayedPositionRef.current = 0
      audioStreamingActiveRef.current = false
    }
  }

  const handleStreamedResponse = async (
    response: Response,
    setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
    scrollToBottom: () => void,
    userHasScrolled?: boolean,
    streamingOptions?: StreamingOptions
  ) => {
    // Set streaming state
    setIsStreamingResponse(true)
    abortControllerRef.current = new AbortController()

    // Check if we should stream audio
    const shouldPlayAudio =
      streamingOptions?.voiceSettings?.isVoiceEnabled &&
      streamingOptions?.voiceSettings?.autoPlayResponses &&
      streamingOptions?.audioStreamHandler

    const reader = response.body?.getReader()
    if (!reader) {
      setIsLoading(false)
      setIsStreamingResponse(false)
      return
    }

    const decoder = new TextDecoder()
    let lastAudioPosition = 0

    // Track which blocks have streamed content as separate messages
    const messageIdMap = new Map<string, string>()
    const aggregatedCopyId = crypto.randomUUID()

    setIsLoading(false)

    try {
      while (true) {
        // Check if aborted
        if (abortControllerRef.current === null) {
          break
        }

        const { done, value } = await reader.read()

        if (done) {
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.substring(6))
              const { blockId, chunk: contentChunk, event: eventType } = json

              // Ignore pure start markers if any ever slip through
              if (eventType === 'start') {
                continue
              }

              if (eventType === 'final' && json.data) {
                // The backend has already processed and combined all outputs
                // If we didn't stream any per-block messages, create a single message
                const result = json.data as ExecutionResult
                if (messageIdMap.size === 0) {
                  let combinedContent = ''
                  if (result.logs) {
                    const contentParts: string[] = []
                    result.logs.forEach((log) => {
                      if (log.output?.content && typeof log.output.content === 'string') {
                        contentParts.push(log.output.content)
                      }
                    })
                    combinedContent = contentParts.join('')
                  }
                  // Append a single consolidated assistant message with copy enabled
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: aggregatedCopyId,
                      content: combinedContent,
                      type: 'assistant',
                      timestamp: new Date(),
                      isStreaming: false,
                    },
                  ])
                }
                continue
              }

              if (blockId && contentChunk) {
                // Create a new message for this block on first chunk
                if (!messageIdMap.has(blockId)) {
                  const newId = crypto.randomUUID()
                  messageIdMap.set(blockId, newId)
                  accumulatedTextRef.current[blockId] = ''
                  lastStreamedPositionRef.current[blockId] = 0

                  // Ignore pure separator chunks at start
                  const initialChunk = contentChunk === '\n\n' ? '' : contentChunk
                  accumulatedTextRef.current[blockId] += initialChunk

                  setMessages((prev) => [
                    ...prev,
                    {
                      id: newId,
                      content: initialChunk,
                      type: 'assistant',
                      timestamp: new Date(),
                      isStreaming: true,
                      suppressCopy: true,
                    },
                  ])
                } else {
                  const msgId = messageIdMap.get(blockId)!
                  accumulatedTextRef.current[blockId] += contentChunk
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === msgId
                        ? { ...msg, content: accumulatedTextRef.current[blockId] }
                        : msg
                    )
                  )
                }

                // Real-time TTS for voice mode
                if (shouldPlayAudio && streamingOptions?.audioStreamHandler) {
                  const acc = accumulatedTextRef.current[blockId] || ''
                  const newText = acc.substring(lastAudioPosition)
                  const sentenceEndings = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '.', '!', '?']
                  let sentenceEnd = -1

                  for (const ending of sentenceEndings) {
                    const index = newText.indexOf(ending)
                    if (index > 0) {
                      sentenceEnd = index + ending.length
                      break
                    }
                  }

                  if (sentenceEnd > 0) {
                    const sentence = newText.substring(0, sentenceEnd).trim()
                    if (sentence && sentence.length >= 3) {
                      try {
                        await streamingOptions.audioStreamHandler(sentence)
                        lastAudioPosition += sentenceEnd
                      } catch (error) {
                        logger.error('TTS error:', error)
                      }
                    }
                  }
                }
              } else if (blockId && eventType === 'end') {
                const msgId = messageIdMap.get(blockId)
                if (msgId) {
                  setMessages((prev) =>
                    prev.map((msg) => (msg.id === msgId ? { ...msg, isStreaming: false } : msg))
                  )
                }
              }
            } catch (parseError) {
              logger.error('Error parsing stream data:', parseError)
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error processing stream:', error)
      // Mark the latest streaming assistant messages as complete
      setMessages((prev) =>
        prev.map((msg) =>
          msg.type === 'assistant' && msg.isStreaming ? { ...msg, isStreaming: false } : msg
        )
      )
    } finally {
      setIsStreamingResponse(false)
      abortControllerRef.current = null

      if (!userHasScrolled) {
        setTimeout(() => {
          scrollToBottom()
        }, 300)
      }

      if (shouldPlayAudio) {
        streamingOptions?.onAudioEnd?.()
      }

      // After streaming completes, append a single consolidated copy message when per-block
      // messages were streamed.
      try {
        const hadPerBlockMessages = messageIdMap.size > 0
        if (hadPerBlockMessages) {
          // Preserve stream order using messageIdMap insertion order
          const orderedBlockIds: string[] = []
          for (const [bId] of messageIdMap) orderedBlockIds.push(bId)
          const parts: string[] = []
          orderedBlockIds.forEach((bId, idx) => {
            const text = accumulatedTextRef.current[bId] || ''
            if (text) parts.push(idx > 0 ? `\n\n${text}` : text)
          })
          const combined = parts.join('')
          setMessages((prev) => [
            ...prev,
            {
              id: aggregatedCopyId,
              content: combined,
              type: 'assistant',
              timestamp: new Date(),
              isStreaming: false,
              hideContent: true,
            },
          ])
        }
      } catch (e) {
        logger.error('Failed to append consolidated copy message:', e)
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
