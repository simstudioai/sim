'use client'

import { useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import type { ChatFile, ChatMessage } from '@/app/chat/components/message/message'
import { CHAT_ERROR_MESSAGES } from '@/app/chat/constants'

const logger = createLogger('UseChatStreaming')

function extractFilesFromData(
  data: any,
  files: ChatFile[] = [],
  seenIds = new Set<string>()
): ChatFile[] {
  if (!data || typeof data !== 'object') {
    return files
  }

  if (isUserFileWithMetadata(data)) {
    if (!seenIds.has(data.id)) {
      seenIds.add(data.id)
      files.push({
        id: data.id,
        name: data.name,
        url: data.url,
        key: data.key,
        size: data.size,
        type: data.type,
        context: data.context,
      })
    }
    return files
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      extractFilesFromData(item, files, seenIds)
    }
    return files
  }

  for (const value of Object.values(data)) {
    extractFilesFromData(value, files, seenIds)
  }

  return files
}

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
  outputConfigs?: Array<{ blockId: string; path?: string }>
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

      const latestContent = accumulatedTextRef.current

      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1]

        if (lastMessage && lastMessage.type === 'assistant') {
          const content = latestContent || lastMessage.content
          const updatedContent =
            content + (content ? '\n\n_Response stopped by user._' : '_Response stopped by user._')

          return [
            ...prev.slice(0, -1),
            { ...lastMessage, content: updatedContent, isStreaming: false },
          ]
        }

        return prev
      })

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
    logger.info('[useChatStreaming] handleStreamedResponse called')
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
    let accumulatedText = ''
    let lastAudioPosition = 0

    const messageIdMap = new Map<string, string>()
    const messageId = generateId()

    const UI_BATCH_MAX_MS = 50
    let uiDirty = false
    let uiRAF: number | null = null
    let uiTimer: ReturnType<typeof setTimeout> | null = null
    let lastUIFlush = 0

    const flushUI = () => {
      if (uiRAF !== null) {
        cancelAnimationFrame(uiRAF)
        uiRAF = null
      }
      if (uiTimer !== null) {
        clearTimeout(uiTimer)
        uiTimer = null
      }
      if (!uiDirty) return
      uiDirty = false
      lastUIFlush = performance.now()
      const snapshot = accumulatedText
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg
          if (!msg.isStreaming) return msg
          return { ...msg, content: snapshot }
        })
      )
    }

    const scheduleUIFlush = () => {
      if (uiRAF !== null) return
      const elapsed = performance.now() - lastUIFlush
      if (elapsed >= UI_BATCH_MAX_MS) {
        flushUI()
        return
      }
      uiRAF = requestAnimationFrame(flushUI)
      if (uiTimer === null) {
        uiTimer = setTimeout(flushUI, Math.max(0, UI_BATCH_MAX_MS - elapsed))
      }
    }
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

    setIsLoading(false)

    try {
      while (true) {
        // Check if aborted
        if (abortControllerRef.current === null) {
          break
        }

        const { done, value } = await reader.read()

        if (done) {
          flushUI()
          // Stream any remaining text for TTS
          if (
            shouldPlayAudio &&
            streamingOptions?.audioStreamHandler &&
            accumulatedText.length > lastAudioPosition
          ) {
            const remainingText = accumulatedText.substring(lastAudioPosition).trim()
            if (remainingText) {
              try {
                await streamingOptions.audioStreamHandler(remainingText)
              } catch (error) {
                logger.error('TTS error for remaining text:', error)
              }
            }
          }
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6)

            if (data === '[DONE]') {
              continue
            }

            try {
              const json = JSON.parse(data)
              const { blockId, chunk: contentChunk, event: eventType } = json

              if (eventType === 'error' || json.event === 'error') {
                const errorMessage = json.error || CHAT_ERROR_MESSAGES.GENERIC_ERROR
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          content: errorMessage,
                          isStreaming: false,
                          type: 'assistant' as const,
                        }
                      : msg
                  )
                )
                setIsLoading(false)
                return
              }

              if (eventType === 'final' && json.data) {
                flushUI()
                const finalData = json.data as {
                  success: boolean
                  error?: string | { message?: string }
                  output?: Record<string, Record<string, any>>
                }

                const outputConfigs = streamingOptions?.outputConfigs
                const formattedOutputs: string[] = []
                let extractedFiles: ChatFile[] = []

                const formatValue = (value: any): string | null => {
                  if (value === null || value === undefined) {
                    return null
                  }

                  if (isUserFileWithMetadata(value)) {
                    return null
                  }

                  if (Array.isArray(value) && value.length === 0) {
                    return null
                  }

                  if (typeof value === 'string') {
                    return value
                  }

                  if (typeof value === 'object') {
                    try {
                      return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
                    } catch {
                      return String(value)
                    }
                  }

                  return String(value)
                }

                const getOutputValue = (blockOutputs: Record<string, any>, path?: string) => {
                  if (!path || path === 'content') {
                    if (blockOutputs.content !== undefined) return blockOutputs.content
                    if (blockOutputs.result !== undefined) return blockOutputs.result
                    return blockOutputs
                  }

                  if (blockOutputs[path] !== undefined) {
                    return blockOutputs[path]
                  }

                  if (path.includes('.')) {
                    return path.split('.').reduce<any>((current, segment) => {
                      if (current && typeof current === 'object' && segment in current) {
                        return current[segment]
                      }
                      return undefined
                    }, blockOutputs)
                  }

                  return undefined
                }

                if (outputConfigs?.length && finalData.output) {
                  for (const config of outputConfigs) {
                    const blockOutputs = finalData.output[config.blockId]
                    if (!blockOutputs) continue

                    const value = getOutputValue(blockOutputs, config.path)

                    if (isUserFileWithMetadata(value)) {
                      extractedFiles.push({
                        id: value.id,
                        name: value.name,
                        url: value.url,
                        key: value.key,
                        size: value.size,
                        type: value.type,
                        context: value.context,
                      })
                      continue
                    }

                    const nestedFiles = extractFilesFromData(value)
                    if (nestedFiles.length > 0) {
                      extractedFiles = [...extractedFiles, ...nestedFiles]
                      continue
                    }

                    const formatted = formatValue(value)
                    if (formatted) {
                      formattedOutputs.push(formatted)
                    }
                  }
                }

                let finalContent = accumulatedText

                if (formattedOutputs.length > 0) {
                  const nonEmptyOutputs = formattedOutputs.filter((output) => output.trim())
                  if (nonEmptyOutputs.length > 0) {
                    const combinedOutputs = nonEmptyOutputs.join('\n\n')
                    finalContent = finalContent
                      ? `${finalContent.trim()}\n\n${combinedOutputs}`
                      : combinedOutputs
                  }
                }

                if (!finalContent && extractedFiles.length === 0) {
                  if (finalData.error) {
                    if (typeof finalData.error === 'string') {
                      finalContent = finalData.error
                    } else if (typeof finalData.error?.message === 'string') {
                      finalContent = finalData.error.message
                    }
                  } else if (finalData.success && finalData.output) {
                    const fallbackOutput = Object.values(finalData.output)
                      .map((block) => formatValue(block)?.trim())
                      .filter(Boolean)[0]
                    if (fallbackOutput) {
                      finalContent = fallbackOutput
                    }
                  }
                }

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          isStreaming: false,
                          content: finalContent ?? msg.content,
                          files: extractedFiles.length > 0 ? extractedFiles : undefined,
                        }
                      : msg
                  )
                )

                accumulatedTextRef.current = ''
                lastStreamedPositionRef.current = 0
                lastDisplayedPositionRef.current = 0
                audioStreamingActiveRef.current = false

                return
              }

              if (blockId && contentChunk) {
                if (!messageIdMap.has(blockId)) {
                  messageIdMap.set(blockId, messageId)
                }

                accumulatedText += contentChunk
                accumulatedTextRef.current = accumulatedText
                logger.debug('[useChatStreaming] Received chunk', {
                  blockId,
                  chunkLength: contentChunk.length,
                  totalLength: accumulatedText.length,
                  messageId,
                  chunk: contentChunk.substring(0, 20),
                })
                uiDirty = true
                scheduleUIFlush()

                // Real-time TTS for voice mode
                if (shouldPlayAudio && streamingOptions?.audioStreamHandler) {
                  const newText = accumulatedText.substring(lastAudioPosition)
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
                setMessages((prev) =>
                  prev.map((msg) => (msg.id === messageId ? { ...msg, isStreaming: false } : msg))
                )
              }
            } catch (parseError) {
              logger.error('Error parsing stream data:', parseError)
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error processing stream:', error)
      flushUI()
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, isStreaming: false } : msg))
      )
    } finally {
      if (uiRAF !== null) cancelAnimationFrame(uiRAF)
      if (uiTimer !== null) clearTimeout(uiTimer)
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
