'use client'

import { useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import {
  anyToolCallRunning,
  applyToolCallPhase,
  settleRunningToolCalls,
  snapshotToolCalls,
  toolCallKey,
} from '@/components/agent-stream/tool-call-lifecycle'
import { readSSEEvents } from '@/lib/core/utils/sse'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  isChatChunkFrame,
  isChatChunkResetFrame,
  isChatErrorFrame,
  isChatFinalFrame,
  isChatStreamErrorFrame,
  isChatThinkingFrame,
  isChatToolFrame,
} from '@/lib/workflows/streaming/agent-stream-protocol'
import type {
  ChatFile,
  ChatMessage,
  ChatToolCall,
} from '@/app/(interfaces)/chat/components/message/message'
import { CHAT_ERROR_MESSAGES } from '@/app/(interfaces)/chat/constants'

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

interface VoiceSettings {
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
  /**
   * Shared AbortController for fetch + SSE body reads. When provided (preferred),
   * Stop aborts the in-flight request server-side as well as the reader.
   */
  abortController?: AbortController
}

/** Client-side view of the `final` frame's opaque `data` payload. */
interface ChatFinalData {
  success?: boolean
  error?: string | { message?: string }
  output?: Record<string, Record<string, any>>
}

export function useChatStreaming() {
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const accumulatedTextRef = useRef<string>('')
  const accumulatedThinkingRef = useRef<string>('')
  const accumulatedToolCallsRef = useRef<ChatToolCall[]>([])
  const lastStreamedPositionRef = useRef<number>(0)
  const audioStreamingActiveRef = useRef<boolean>(false)
  const lastDisplayedPositionRef = useRef<number>(0)

  const stopStreaming = (setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null

      const latestContent = accumulatedTextRef.current
      const latestThinking = accumulatedThinkingRef.current
      const latestTools = accumulatedToolCallsRef.current.map((tool) =>
        tool.status === 'running' ? { ...tool, status: 'cancelled' as const } : tool
      )

      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1]

        if (lastMessage && lastMessage.type === 'assistant') {
          const content = latestContent || lastMessage.content
          const updatedContent =
            content + (content ? '\n\n_Response stopped by user._' : '_Response stopped by user._')

          return [
            ...prev.slice(0, -1),
            {
              ...lastMessage,
              content: updatedContent,
              // Preserve any thinking / tools received before Stop.
              thinking: latestThinking || lastMessage.thinking,
              toolCalls: latestTools.length > 0 ? latestTools : lastMessage.toolCalls,
              isStreaming: false,
              isThinkingStreaming: false,
              isToolStreaming: false,
            },
          ]
        }

        return prev
      })

      setIsStreamingResponse(false)
      accumulatedTextRef.current = ''
      accumulatedThinkingRef.current = ''
      accumulatedToolCallsRef.current = []
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
    streamingOptions?: StreamingOptions
  ) => {
    logger.info('[useChatStreaming] handleStreamedResponse called')
    setIsStreamingResponse(true)

    // Prefer a shared controller from the caller (fetch + reader). Otherwise create one.
    if (streamingOptions?.abortController) {
      abortControllerRef.current = streamingOptions.abortController
    } else if (!abortControllerRef.current) {
      abortControllerRef.current = new AbortController()
    }

    const shouldPlayAudio =
      streamingOptions?.voiceSettings?.isVoiceEnabled &&
      streamingOptions?.voiceSettings?.autoPlayResponses &&
      streamingOptions?.audioStreamHandler

    if (!response.body) {
      setIsLoading(false)
      setIsStreamingResponse(false)
      return
    }

    /**
     * Answer text tracked per block so a `chunk_reset` (dual-gated streams:
     * a live-streamed turn resolved to tool calls) can clear one block's
     * contribution. `accumulatedText` is re-derived on every mutation —
     * cross-block separators arrive baked into the chunks.
     */
    const blockTextOrder: string[] = []
    const blockTextSegments = new Map<string, string>()
    let accumulatedText = ''
    const recomputeAccumulatedText = () => {
      accumulatedText = blockTextOrder.map((id) => blockTextSegments.get(id) ?? '').join('')
      accumulatedTextRef.current = accumulatedText
    }
    let accumulatedThinking = ''
    let isThinkingStreaming = false
    let lastAudioPosition = 0
    const toolCallsMap = new Map<string, ChatToolCall>()
    const toolCallOrder: string[] = []

    const syncToolCallsRef = () => {
      accumulatedToolCallsRef.current = snapshotToolCalls(toolCallOrder, toolCallsMap) ?? []
    }

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
      const contentSnapshot = accumulatedText
      const thinkingSnapshot = accumulatedThinking
      const thinkingStreamingSnapshot = isThinkingStreaming
      const toolCallsSnapshot = snapshotToolCalls(toolCallOrder, toolCallsMap)
      const toolStreamingSnapshot = anyToolCallRunning(toolCallsMap)
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg
          if (!msg.isStreaming) return msg
          return {
            ...msg,
            content: contentSnapshot,
            thinking: thinkingSnapshot || undefined,
            isThinkingStreaming: thinkingStreamingSnapshot,
            toolCalls: toolCallsSnapshot,
            isToolStreaming: toolStreamingSnapshot,
          }
        })
      )
      // Caller supplies a stick-to-bottom-aware scroller (no-ops if user scrolled away).
      requestAnimationFrame(() => {
        scrollToBottom()
      })
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

    let terminated = false
    // Capture before Stop nulls abortControllerRef; needed when the reader
    // resolves on abort instead of throwing AbortError.
    const streamAbortSignal = abortControllerRef.current!.signal

    try {
      await readSSEEvents<Record<string, unknown>>(response.body, {
        signal: streamAbortSignal,
        onParseError: (_data, parseError) => {
          logger.error('Error parsing stream data:', parseError)
        },
        onEvent: async (json) => {
          if (isChatErrorFrame(json)) {
            // User Stop aborts the fetch; the server often still emits a terminal
            // `{ event: 'error', error: 'Client cancelled request' }` before the
            // SSE reader finishes. Do not overwrite the stop notice.
            if (streamAbortSignal.aborted) {
              settleRunningToolCalls(toolCallsMap, 'cancelled')
              syncToolCallsRef()
              const toolsSnapshot = snapshotToolCalls(toolCallOrder, toolCallsMap)
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        isStreaming: false,
                        isThinkingStreaming: false,
                        isToolStreaming: false,
                        thinking: accumulatedThinking || msg.thinking,
                        toolCalls: toolsSnapshot ?? msg.toolCalls,
                      }
                    : msg
                )
              )
              setIsLoading(false)
              terminated = true
              return true
            }

            const errorMessage = json.error || CHAT_ERROR_MESSAGES.GENERIC_ERROR
            settleRunningToolCalls(toolCallsMap, 'error')
            syncToolCallsRef()
            const toolsSnapshot = snapshotToolCalls(toolCallOrder, toolCallsMap)
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      content: errorMessage,
                      thinking: accumulatedThinking || msg.thinking,
                      toolCalls: toolsSnapshot ?? msg.toolCalls,
                      isStreaming: false,
                      isThinkingStreaming: false,
                      isToolStreaming: false,
                      type: 'assistant' as const,
                    }
                  : msg
              )
            )
            setIsLoading(false)
            terminated = true
            return true
          }

          if (isChatStreamErrorFrame(json)) {
            // Non-terminal mid-block read issue: keep streaming. The legacy
            // client ignored these frames; log only — never repurpose the
            // thinking lane for error text.
            logger.warn('[useChatStreaming] Non-terminal stream_error', {
              blockId: json.blockId,
              error: json.error || 'A streaming error occurred',
            })
            return false
          }

          if (isChatThinkingFrame(json)) {
            if (!messageIdMap.has(json.blockId)) {
              messageIdMap.set(json.blockId, messageId)
            }
            accumulatedThinking += json.data
            accumulatedThinkingRef.current = accumulatedThinking
            isThinkingStreaming = true
            uiDirty = true
            scheduleUIFlush()
            return false
          }

          if (isChatToolFrame(json)) {
            const { blockId } = json
            if (!messageIdMap.has(blockId)) {
              messageIdMap.set(blockId, messageId)
            }
            // Tools starting means the turn's thinking phase is over — settle
            // the thinking chrome (it re-opens if more thinking streams later).
            if (json.phase === 'start' && isThinkingStreaming) {
              isThinkingStreaming = false
            }
            applyToolCallPhase(
              toolCallsMap,
              toolCallOrder,
              {
                key: toolCallKey(blockId, json.id),
                id: json.id,
                name: json.name,
                phase: json.phase,
                status: json.status,
              },
              (tool): ChatToolCall => ({
                ...tool,
                blockId,
                displayName: tool.displayName ?? tool.name,
              })
            )
            syncToolCallsRef()
            uiDirty = true
            scheduleUIFlush()
            return false
          }

          if (isChatFinalFrame(json)) {
            flushUI()
            const finalData = json.data as ChatFinalData
            isThinkingStreaming = false
            settleRunningToolCalls(toolCallsMap, 'success')
            syncToolCallsRef()
            const toolsSnapshot = snapshotToolCalls(toolCallOrder, toolCallsMap)

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
                      isThinkingStreaming: false,
                      isToolStreaming: false,
                      content: finalContent ?? msg.content,
                      thinking: accumulatedThinking || msg.thinking,
                      toolCalls: toolsSnapshot ?? msg.toolCalls,
                      files: extractedFiles.length > 0 ? extractedFiles : undefined,
                    }
                  : msg
              )
            )

            accumulatedTextRef.current = ''
            accumulatedThinkingRef.current = ''
            accumulatedToolCallsRef.current = []
            lastStreamedPositionRef.current = 0
            lastDisplayedPositionRef.current = 0
            audioStreamingActiveRef.current = false

            terminated = true
            return true
          }

          if (isChatChunkResetFrame(json)) {
            // The block's live-streamed text belonged to an intermediate turn
            // (tool calls follow); drop it — the final turn re-streams after.
            // Remove the block from the order too: its re-streamed text
            // re-registers at the end, keeping render order = arrival order
            // (the server re-computes the cross-block separator on re-stream).
            const { blockId } = json
            if (blockTextSegments.has(blockId)) {
              blockTextSegments.delete(blockId)
              const orderIndex = blockTextOrder.indexOf(blockId)
              if (orderIndex !== -1) {
                blockTextOrder.splice(orderIndex, 1)
              }
              recomputeAccumulatedText()
              // Spoken audio cannot be unplayed; clamp so slicing stays valid.
              lastAudioPosition = Math.min(lastAudioPosition, accumulatedText.length)
              uiDirty = true
              scheduleUIFlush()
            }
            return false
          }

          // Answer text only — never append thinking/tool/unknown chunk frames blindly.
          if (isChatChunkFrame(json)) {
            const { blockId, chunk: contentChunk } = json
            if (!messageIdMap.has(blockId)) {
              messageIdMap.set(blockId, messageId)
            }

            // First answer chunk settles thinking chrome (still visible, no longer “live”).
            if (isThinkingStreaming) {
              isThinkingStreaming = false
            }

            if (!blockTextSegments.has(blockId)) {
              blockTextOrder.push(blockId)
              blockTextSegments.set(blockId, '')
            }
            blockTextSegments.set(blockId, blockTextSegments.get(blockId)! + contentChunk)
            recomputeAccumulatedText()
            logger.debug('[useChatStreaming] Received chunk', {
              blockId,
              chunkLength: contentChunk.length,
              totalLength: accumulatedText.length,
              messageId,
              chunk: contentChunk.substring(0, 20),
            })
            uiDirty = true
            scheduleUIFlush()

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
          }
        },
      })

      if (!terminated) {
        flushUI()
        // Stream closed without a terminal final/error frame (abrupt disconnect,
        // or only non-terminal stream_error). Clear live chrome so the UI does not
        // stay stuck in a streaming/loading state.
        const wasAborted = streamAbortSignal.aborted
        settleRunningToolCalls(toolCallsMap, wasAborted ? 'cancelled' : 'error')
        syncToolCallsRef()
        isThinkingStreaming = false
        const toolsSnapshot = snapshotToolCalls(toolCallOrder, toolCallsMap)
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== messageId) return msg
            // stopStreaming already wrote the stop notice into content; do not clobber it.
            if (wasAborted) {
              return {
                ...msg,
                isStreaming: false,
                isThinkingStreaming: false,
                isToolStreaming: false,
                thinking: accumulatedThinking || msg.thinking,
                toolCalls: toolsSnapshot ?? msg.toolCalls,
              }
            }
            return {
              ...msg,
              isStreaming: false,
              isThinkingStreaming: false,
              isToolStreaming: false,
              content: accumulatedText || msg.content,
              thinking: accumulatedThinking || msg.thinking,
              toolCalls: toolsSnapshot ?? msg.toolCalls,
            }
          })
        )
        if (
          !wasAborted &&
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
      }
    } catch (error) {
      // Stop / timeout abort the shared fetch controller; body read then throws AbortError.
      // Match chat.tsx + use-audio-streaming: expected cancel, not a hard failure.
      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('Stream aborted by user or timeout')
        settleRunningToolCalls(toolCallsMap, 'cancelled')
      } else {
        logger.error('Error processing stream:', error)
        settleRunningToolCalls(toolCallsMap, 'error')
      }
      syncToolCallsRef()
      flushUI()
      const toolsSnapshot = snapshotToolCalls(toolCallOrder, toolCallsMap)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                isStreaming: false,
                isThinkingStreaming: false,
                isToolStreaming: false,
                thinking: accumulatedThinking || msg.thinking,
                toolCalls: toolsSnapshot ?? msg.toolCalls,
              }
            : msg
        )
      )
    } finally {
      if (uiRAF !== null) cancelAnimationFrame(uiRAF)
      if (uiTimer !== null) clearTimeout(uiTimer)
      setIsStreamingResponse(false)
      abortControllerRef.current = null

      // Stick-to-bottom-aware; no-ops if the user scrolled away mid-stream.
      setTimeout(() => {
        scrollToBottom()
      }, 300)

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
