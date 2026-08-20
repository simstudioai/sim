'use client'

import { useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import type { ChatMessage } from '../components/message/message'

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
  const accumulatedTextRef = useRef<string>('')
  const lastStreamedPositionRef = useRef<number>(0)
  const audioStreamingActiveRef = useRef<boolean>(false)
  const lastDisplayedPositionRef = useRef<number>(0) // Track displayed text in synced mode

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

      // Reset streaming state immediately
      setIsStreamingResponse(false)
      accumulatedTextRef.current = ''
      lastStreamedPositionRef.current = 0
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
    const messageId = crypto.randomUUID()

    // Set streaming state before adding the assistant message
    setIsStreamingResponse(true)

    // Reset refs
    accumulatedTextRef.current = ''
    lastStreamedPositionRef.current = 0
    lastDisplayedPositionRef.current = 0
    audioStreamingActiveRef.current = false

    // Check if we should stream audio
    const shouldStreamAudio =
      streamingOptions?.voiceSettings?.isVoiceEnabled &&
      streamingOptions?.voiceSettings?.autoPlayResponses &&
      streamingOptions?.audioStreamHandler

    // Get voice-first mode settings
    const voiceFirstMode = streamingOptions?.voiceSettings?.voiceFirstMode
    const textStreamingMode = streamingOptions?.voiceSettings?.textStreamingInVoiceMode || 'normal'
    const conversationMode = streamingOptions?.voiceSettings?.conversationMode

    // In voice-first mode with hidden text, don't show text at all
    const shouldShowText = !voiceFirstMode || textStreamingMode !== 'hidden'

    // Add placeholder message
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        content: shouldShowText ? '' : '🎵 Generating audio response...',
        type: 'assistant',
        timestamp: new Date(),
        isStreaming: true,
        isVoiceOnly: voiceFirstMode && textStreamingMode === 'hidden',
      },
    ])

    // Stop showing loading indicator once streaming begins
    setIsLoading(false)

    // Start audio if in voice mode
    if (shouldStreamAudio) {
      streamingOptions.onAudioStart?.()
      audioStreamingActiveRef.current = true
    }

    // Helper function to update displayed text based on mode
    const updateDisplayedText = (fullText: string, audioPosition?: number) => {
      let displayText = fullText

      if (voiceFirstMode && textStreamingMode === 'synced') {
        // Only show text up to where audio has been streamed
        displayText = fullText.substring(0, audioPosition || lastStreamedPositionRef.current)
      } else if (voiceFirstMode && textStreamingMode === 'hidden') {
        // Don't update text content, keep voice indicator
        return
      }

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            return {
              ...msg,
              content: displayText,
            }
          }
          return msg
        })
      )
    }

    // Helper function to clean up after streaming ends (success or error)
    const cleanupStreaming = (messageContent?: string, appendContent = false) => {
      // Reset streaming state and controller
      setIsStreamingResponse(false)
      abortControllerRef.current = null
      accumulatedTextRef.current = ''
      lastStreamedPositionRef.current = 0
      lastDisplayedPositionRef.current = 0
      audioStreamingActiveRef.current = false

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
              isVoiceOnly: false,
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

      // End audio streaming
      if (shouldStreamAudio) {
        streamingOptions.onAudioEnd?.()
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
            break
          }

          const { value, done: readerDone } = await reader.read()
          done = readerDone

          if (value) {
            const chunk = decoder.decode(value, { stream: true })
            if (chunk) {
              // Accumulate text
              accumulatedTextRef.current += chunk

              // Update the message with the accumulated text based on mode
              if (shouldShowText) {
                updateDisplayedText(accumulatedTextRef.current)
              }

              // Stream audio in real-time for meaningful sentences
              if (
                shouldStreamAudio &&
                streamingOptions.audioStreamHandler &&
                audioStreamingActiveRef.current
              ) {
                const newText = accumulatedTextRef.current.substring(
                  lastStreamedPositionRef.current
                )

                // Use sentence-based streaming for natural audio flow
                const sentenceEndings = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '.', '!', '?']
                let sentenceEnd = -1

                // Find the first complete sentence
                for (const ending of sentenceEndings) {
                  const index = newText.indexOf(ending)
                  if (index > 0) {
                    // Make sure we include the punctuation
                    sentenceEnd = index + ending.length
                    break
                  }
                }

                // If we found a complete sentence, stream it
                if (sentenceEnd > 0) {
                  const sentence = newText.substring(0, sentenceEnd).trim()
                  if (sentence && sentence.length >= 3) {
                    // Only send meaningful sentences
                    try {
                      // Stream this sentence to audio
                      await streamingOptions.audioStreamHandler(sentence)
                      lastStreamedPositionRef.current += sentenceEnd

                      // Update displayed text in synced mode
                      if (voiceFirstMode && textStreamingMode === 'synced') {
                        updateDisplayedText(
                          accumulatedTextRef.current,
                          lastStreamedPositionRef.current
                        )
                      }
                    } catch (error) {
                      logger.error('Error streaming audio sentence:', error)
                      // Don't stop on individual sentence errors, but log them
                      if (error instanceof Error && error.message.includes('401')) {
                        logger.warn('TTS authentication error, stopping audio streaming')
                        audioStreamingActiveRef.current = false
                      }
                    }
                  }
                } else if (newText.length > 200 && done) {
                  // If streaming has ended and we have a long incomplete sentence, stream it anyway
                  const incompleteSentence = newText.trim()
                  if (incompleteSentence && incompleteSentence.length >= 10) {
                    try {
                      await streamingOptions.audioStreamHandler(incompleteSentence)
                      lastStreamedPositionRef.current += newText.length

                      if (voiceFirstMode && textStreamingMode === 'synced') {
                        updateDisplayedText(
                          accumulatedTextRef.current,
                          lastStreamedPositionRef.current
                        )
                      }
                    } catch (error) {
                      logger.error('Error streaming incomplete sentence:', error)
                    }
                  }
                }
              }
            }
          }
        }

        // Handle any remaining text for audio streaming when streaming completes
        if (
          shouldStreamAudio &&
          streamingOptions.audioStreamHandler &&
          audioStreamingActiveRef.current
        ) {
          const remainingText = accumulatedTextRef.current
            .substring(lastStreamedPositionRef.current)
            .trim()
          if (remainingText && remainingText.length >= 3) {
            try {
              await streamingOptions.audioStreamHandler(remainingText)

              // Final update for synced mode
              if (voiceFirstMode && textStreamingMode === 'synced') {
                updateDisplayedText(accumulatedTextRef.current, accumulatedTextRef.current.length)
              }
            } catch (error) {
              logger.error('Error streaming final remaining text:', error)
            }
          }
        }
      } catch (error) {
        // Show error to user in the message
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error during streaming'
        logger.error('Error reading stream:', error)
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
