'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUp,
  MoreVertical,
  Paperclip,
  Square,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverTrigger,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  parseOutputContentSafely,
} from '@/lib/core/utils/response-format'
import { normalizeInputFormatValue } from '@/lib/workflows/input-format'
import { StartBlockPath, TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { START_BLOCK_RESERVED_FIELDS } from '@/lib/workflows/types'
import {
  ChatMessage,
  OutputSelect,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components'
import { useChatFileUpload } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/hooks'
import {
  usePreventZoom,
  useScrollManagement,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import {
  useFloatBoundarySync,
  useFloatDrag,
  useFloatResize,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/float'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import type { BlockLog, ExecutionResult } from '@/executor/types'
import { useChatStore } from '@/stores/chat/store'
import { getChatPosition } from '@/stores/chat/utils'
import { useExecutionStore } from '@/stores/execution'
import { useOperationQueue } from '@/stores/operation-queue/store'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('FloatingChat')

/**
 * Formats file size in human-readable format
 * @param bytes - Size in bytes
 * @returns Formatted string with appropriate unit (B, KB, MB, GB)
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${Math.round((bytes / 1024 ** i) * 10) / 10} ${units[i]}`
}

/**
 * Represents a chat file attachment before processing
 */
interface ChatFile {
  id: string
  name: string
  type: string
  size: number
  file: File
}

/**
 * Represents a processed file attachment with data URL for display
 */
interface ProcessedAttachment {
  id: string
  name: string
  type: string
  size: number
  dataUrl: string
}

/** Timeout for FileReader operations in milliseconds */
const FILE_READ_TIMEOUT_MS = 60000

/**
 * Reads files and converts them to data URLs for image display
 * @param chatFiles - Array of chat files to process
 * @returns Promise resolving to array of files with data URLs for images
 */
const processFileAttachments = async (chatFiles: ChatFile[]): Promise<ProcessedAttachment[]> => {
  return Promise.all(
    chatFiles.map(async (file) => {
      let dataUrl = ''
      if (file.type.startsWith('image/')) {
        try {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            let settled = false

            const timeoutId = setTimeout(() => {
              if (!settled) {
                settled = true
                reader.abort()
                reject(new Error(`File read timed out after ${FILE_READ_TIMEOUT_MS}ms`))
              }
            }, FILE_READ_TIMEOUT_MS)

            reader.onload = () => {
              if (!settled) {
                settled = true
                clearTimeout(timeoutId)
                resolve(reader.result as string)
              }
            }
            reader.onerror = () => {
              if (!settled) {
                settled = true
                clearTimeout(timeoutId)
                reject(reader.error)
              }
            }
            reader.onabort = () => {
              if (!settled) {
                settled = true
                clearTimeout(timeoutId)
                reject(new Error('File read aborted'))
              }
            }
            reader.readAsDataURL(file.file)
          })
        } catch (error) {
          logger.error('Error reading file as data URL:', error)
        }
      }
      return {
        id: file.id,
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl,
      }
    })
  )
}

/**
 * Extracts output value from logs based on output ID
 * @param logs - Array of block logs from workflow execution
 * @param outputId - Output identifier in format blockId or blockId.path
 * @returns Extracted output value or undefined if not found
 */
const extractOutputFromLogs = (logs: BlockLog[] | undefined, outputId: string): unknown => {
  const blockId = extractBlockIdFromOutputId(outputId)
  const path = extractPathFromOutputId(outputId, blockId)
  const log = logs?.find((l) => l.blockId === blockId)

  if (!log) return undefined

  let output = log.output

  if (path) {
    output = parseOutputContentSafely(output)
    const pathParts = path.split('.')
    let current = output
    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part]
      } else {
        return undefined
      }
    }
    return current
  }

  return output
}

/**
 * Formats output content for display in chat
 * @param output - Output value to format (string, object, or other)
 * @returns Formatted string, markdown code block for objects, or empty string
 */
const formatOutputContent = (output: unknown): string => {
  if (typeof output === 'string') {
    return output
  }
  if (output && typeof output === 'object') {
    return `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``
  }
  return ''
}

/**
 * Represents a field in the start block's input format configuration
 */
interface StartInputFormatField {
  id?: string
  name?: string
  type?: string
  value?: unknown
  collapsed?: boolean
}

/**
 * Floating chat modal component
 *
 * A draggable chat interface positioned over the workflow canvas that allows users to:
 * - Send messages and execute workflows
 * - Upload and attach files
 * - View streaming responses
 * - Select workflow outputs as context
 *
 * The modal is constrained by sidebar, panel, and terminal dimensions and persists
 * position across sessions using the floating chat store.
 */
export function Chat() {
  const { activeWorkflowId } = useWorkflowRegistry()
  const blocks = useWorkflowStore((state) => state.blocks)
  const triggerWorkflowUpdate = useWorkflowStore((state) => state.triggerUpdate)
  const setSubBlockValue = useSubBlockStore((state) => state.setValue)

  const {
    isChatOpen,
    chatPosition,
    chatWidth,
    chatHeight,
    setIsChatOpen,
    setChatPosition,
    setChatDimensions,
    messages,
    addMessage,
    selectedWorkflowOutputs,
    setSelectedWorkflowOutput,
    appendMessageContent,
    finalizeMessageStream,
    getConversationId,
    clearChat,
    exportChatCSV,
  } = useChatStore()

  const hasConsoleHydrated = useTerminalConsoleStore((state) => state._hasHydrated)
  const entriesFromStore = useTerminalConsoleStore((state) => state.entries)
  const entries = hasConsoleHydrated ? entriesFromStore : []
  const { isExecuting } = useExecutionStore()
  const { handleRunWorkflow, handleCancelExecution } = useWorkflowExecution()
  const { data: session } = useSession()
  const { addToQueue } = useOperationQueue()

  const [chatMessage, setChatMessage] = useState('')
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const preventZoomRef = usePreventZoom()

  const {
    chatFiles,
    uploadErrors,
    isDragOver,
    removeFile,
    clearFiles,
    clearErrors,
    handleFileInputChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useChatFileUpload()

  const filePreviewUrls = useRef<Map<string, string>>(new Map())

  const getFilePreviewUrl = useCallback((file: ChatFile): string | null => {
    if (!file.type.startsWith('image/')) return null

    const existing = filePreviewUrls.current.get(file.id)
    if (existing) return existing

    const url = URL.createObjectURL(file.file)
    filePreviewUrls.current.set(file.id, url)
    return url
  }, [])

  useEffect(() => {
    const currentFileIds = new Set(chatFiles.map((f) => f.id))
    const urlMap = filePreviewUrls.current

    for (const [fileId, url] of urlMap.entries()) {
      if (!currentFileIds.has(fileId)) {
        URL.revokeObjectURL(url)
        urlMap.delete(fileId)
      }
    }

    return () => {
      for (const url of urlMap.values()) {
        URL.revokeObjectURL(url)
      }
      urlMap.clear()
    }
  }, [chatFiles])

  /**
   * Resolves the unified start block for chat execution, if available.
   */
  const startBlockCandidate = useMemo(() => {
    if (!activeWorkflowId) {
      return null
    }

    if (!blocks || Object.keys(blocks).length === 0) {
      return null
    }

    const candidate = TriggerUtils.findStartBlock(blocks, 'chat')
    if (!candidate || candidate.path !== StartBlockPath.UNIFIED) {
      return null
    }

    return candidate
  }, [activeWorkflowId, blocks])

  const startBlockId = startBlockCandidate?.blockId ?? null

  /**
   * Reads the current input format for the unified start block from the subblock store,
   * falling back to the workflow store if no explicit value is stored yet.
   */
  const startBlockInputFormat = useSubBlockStore((state) => {
    if (!activeWorkflowId || !startBlockId) {
      return null
    }

    const workflowValues = state.workflowValues[activeWorkflowId]
    const fromStore = workflowValues?.[startBlockId]?.inputFormat
    if (fromStore !== undefined && fromStore !== null) {
      return fromStore
    }

    const startBlock = blocks[startBlockId]
    return startBlock?.subBlocks?.inputFormat?.value ?? null
  })

  /**
   * Determines which reserved start inputs are missing from the input format.
   */
  const missingStartReservedFields = useMemo(() => {
    if (!startBlockId) {
      return START_BLOCK_RESERVED_FIELDS
    }

    const normalizedFields = normalizeInputFormatValue(startBlockInputFormat)
    const existingNames = new Set(
      normalizedFields
        .map((field) => field.name)
        .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
        .map((name) => name.trim().toLowerCase())
    )

    return START_BLOCK_RESERVED_FIELDS.filter(
      (fieldName) => !existingNames.has(fieldName.toLowerCase())
    )
  }, [startBlockId, startBlockInputFormat])

  const shouldShowConfigureStartInputsButton =
    Boolean(startBlockId) && missingStartReservedFields.length > 0

  const actualPosition = useMemo(
    () => getChatPosition(chatPosition, chatWidth, chatHeight),
    [chatPosition, chatWidth, chatHeight]
  )

  const { handleMouseDown } = useFloatDrag({
    position: actualPosition,
    width: chatWidth,
    height: chatHeight,
    onPositionChange: setChatPosition,
  })

  useFloatBoundarySync({
    isOpen: isChatOpen,
    position: actualPosition,
    width: chatWidth,
    height: chatHeight,
    onPositionChange: setChatPosition,
  })

  const {
    cursor: resizeCursor,
    handleMouseMove: handleResizeMouseMove,
    handleMouseLeave: handleResizeMouseLeave,
    handleMouseDown: handleResizeMouseDown,
  } = useFloatResize({
    position: actualPosition,
    width: chatWidth,
    height: chatHeight,
    onPositionChange: setChatPosition,
    onDimensionsChange: setChatDimensions,
  })

  const outputEntries = useMemo(() => {
    if (!activeWorkflowId) return []
    return entries.filter((entry) => entry.workflowId === activeWorkflowId && entry.output)
  }, [entries, activeWorkflowId])

  const workflowMessages = useMemo(() => {
    if (!activeWorkflowId) return []
    return messages
      .filter((msg) => msg.workflowId === activeWorkflowId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [messages, activeWorkflowId])

  const isStreaming = useMemo(() => {
    const lastMessage = workflowMessages[workflowMessages.length - 1]
    return Boolean(lastMessage?.isStreaming)
  }, [workflowMessages])

  const messagesForScrollHook = useMemo(() => {
    return workflowMessages.map((msg) => ({
      ...msg,
      role: msg.type,
    }))
  }, [workflowMessages])

  const { scrollAreaRef, scrollToBottom } = useScrollManagement(
    messagesForScrollHook,
    isStreaming,
    {
      behavior: 'auto',
    }
  )

  const userMessages = useMemo(() => {
    return workflowMessages
      .filter((msg) => msg.type === 'user')
      .map((msg) => msg.content)
      .filter((content): content is string => typeof content === 'string')
  }, [workflowMessages])

  useEffect(() => {
    if (!activeWorkflowId) {
      setPromptHistory([])
      setHistoryIndex(-1)
      return
    }

    setPromptHistory(userMessages)
    setHistoryIndex(-1)
  }, [activeWorkflowId, userMessages])

  /**
   * Auto-scroll to bottom when messages load and chat is open
   */
  useEffect(() => {
    if (workflowMessages.length > 0 && isChatOpen) {
      scrollToBottom()
    }
  }, [workflowMessages.length, scrollToBottom, isChatOpen])

  const selectedOutputs = useMemo(() => {
    if (!activeWorkflowId) return []
    const selected = selectedWorkflowOutputs[activeWorkflowId]
    return selected && selected.length > 0 ? [...new Set(selected)] : []
  }, [selectedWorkflowOutputs, activeWorkflowId])

  /**
   * Focuses the input field with optional delay
   * @param delay - Delay in milliseconds before focusing (default: 0)
   */
  const focusInput = useCallback((delay = 0) => {
    timeoutRef.current && clearTimeout(timeoutRef.current)

    timeoutRef.current = setTimeout(() => {
      if (inputRef.current && document.contains(inputRef.current)) {
        inputRef.current.focus({ preventScroll: true })
      }
    }, delay)
  }, [])

  useEffect(() => {
    return () => {
      timeoutRef.current && clearTimeout(timeoutRef.current)
      streamReaderRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    if (!isExecuting && isStreaming) {
      const lastMessage = workflowMessages[workflowMessages.length - 1]
      if (lastMessage?.isStreaming) {
        streamReaderRef.current?.cancel()
        streamReaderRef.current = null
        finalizeMessageStream(lastMessage.id)
      }
    }
  }, [isExecuting, isStreaming, workflowMessages, finalizeMessageStream])

  const handleStopStreaming = useCallback(() => {
    streamReaderRef.current?.cancel()
    streamReaderRef.current = null
    handleCancelExecution()
  }, [handleCancelExecution])

  /**
   * Processes streaming response from workflow execution
   * Reads the stream chunk by chunk and updates the message content in real-time
   * When the final event arrives, extracts any additional selected outputs (model, tokens, toolCalls)
   * @param stream - ReadableStream containing the workflow execution response
   * @param responseMessageId - ID of the message to update with streamed content
   */
  const processStreamingResponse = useCallback(
    async (stream: ReadableStream, responseMessageId: string) => {
      const reader = stream.getReader()
      streamReaderRef.current = reader
      const decoder = new TextDecoder()
      let accumulatedContent = ''
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            finalizeMessageStream(responseMessageId)
            break
          }

          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk

          const separatorIndex = buffer.lastIndexOf('\n\n')
          if (separatorIndex === -1) {
            continue
          }

          const processable = buffer.slice(0, separatorIndex)
          buffer = buffer.slice(separatorIndex + 2)

          const lines = processable.split('\n\n')

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue

            const data = line.substring(6)
            if (data === '[DONE]') continue

            try {
              const json = JSON.parse(data)
              const { event, data: eventData, chunk: contentChunk } = json

              if (event === 'final' && eventData) {
                const result = eventData as ExecutionResult

                if ('success' in result && !result.success) {
                  const errorMessage = result.error || 'Workflow execution failed'
                  appendMessageContent(
                    responseMessageId,
                    `${accumulatedContent ? '\n\n' : ''}Error: ${errorMessage}`
                  )
                  finalizeMessageStream(responseMessageId)
                  return
                }

                finalizeMessageStream(responseMessageId)
              } else if (contentChunk) {
                accumulatedContent += contentChunk
                appendMessageContent(responseMessageId, contentChunk)
              }
            } catch (e) {
              logger.error('Error parsing stream data:', e)
            }
          }
        }
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          logger.error('Error processing stream:', error)
        }
        finalizeMessageStream(responseMessageId)
      } finally {
        if (streamReaderRef.current === reader) {
          streamReaderRef.current = null
        }
        focusInput(100)
      }
    },
    [appendMessageContent, finalizeMessageStream, focusInput, selectedOutputs, activeWorkflowId]
  )

  /**
   * Handles workflow execution response
   * @param result - The workflow execution result containing stream or logs
   */
  const handleWorkflowResponse = useCallback(
    (result: unknown) => {
      if (!result || !activeWorkflowId) return
      if (typeof result !== 'object') return

      if ('stream' in result && result.stream instanceof ReadableStream) {
        const responseMessageId = crypto.randomUUID()
        addMessage({
          id: responseMessageId,
          content: '',
          workflowId: activeWorkflowId,
          type: 'workflow',
          isStreaming: true,
        })
        processStreamingResponse(result.stream, responseMessageId)
        return
      }

      if ('success' in result && result.success && 'logs' in result && Array.isArray(result.logs)) {
        selectedOutputs
          .map((outputId) => extractOutputFromLogs(result.logs as BlockLog[], outputId))
          .filter((output) => output !== undefined)
          .forEach((output) => {
            const content = formatOutputContent(output)
            if (content) {
              addMessage({
                content,
                workflowId: activeWorkflowId,
                type: 'workflow',
              })
            }
          })
        return
      }

      if ('success' in result && !result.success) {
        const errorMessage =
          'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Workflow execution failed.'
        addMessage({
          content: `Error: ${errorMessage}`,
          workflowId: activeWorkflowId,
          type: 'workflow',
        })
      }
    },
    [activeWorkflowId, selectedOutputs, addMessage, processStreamingResponse]
  )

  /**
   * Sends a chat message and executes the workflow
   * Processes file attachments, adds the user message to the chat,
   * and triggers workflow execution with the message as input
   */
  const handleSendMessage = useCallback(async () => {
    if ((!chatMessage.trim() && chatFiles.length === 0) || !activeWorkflowId || isExecuting) return

    const sentMessage = chatMessage.trim()

    if (sentMessage && promptHistory[promptHistory.length - 1] !== sentMessage) {
      setPromptHistory((prev) => [...prev, sentMessage])
    }
    setHistoryIndex(-1)

    const conversationId = getConversationId(activeWorkflowId)

    try {
      const attachmentsWithData = await processFileAttachments(chatFiles)

      const messageContent =
        sentMessage || (chatFiles.length > 0 ? `Uploaded ${chatFiles.length} file(s)` : '')
      addMessage({
        content: messageContent,
        workflowId: activeWorkflowId,
        type: 'user',
        attachments: attachmentsWithData,
      })

      const workflowInput: {
        input: string
        conversationId: string
        files?: Array<{ name: string; size: number; type: string; file: File }>
        onUploadError?: (message: string) => void
      } = {
        input: sentMessage,
        conversationId,
      }

      if (chatFiles.length > 0) {
        workflowInput.files = chatFiles.map((chatFile) => ({
          name: chatFile.name,
          size: chatFile.size,
          type: chatFile.type,
          file: chatFile.file,
        }))
        workflowInput.onUploadError = (message: string) => {
          logger.error('File upload error:', message)
        }
      }

      setChatMessage('')
      clearFiles()
      clearErrors()
      focusInput(10)

      const result = await handleRunWorkflow(workflowInput)
      handleWorkflowResponse(result)
    } catch (error) {
      logger.error('Error in handleSendMessage:', error)
    }

    focusInput(100)
  }, [
    chatMessage,
    chatFiles,
    activeWorkflowId,
    isExecuting,
    promptHistory,
    getConversationId,
    addMessage,
    handleRunWorkflow,
    handleWorkflowResponse,
    focusInput,
    clearFiles,
    clearErrors,
  ])

  /**
   * Handles keyboard input for chat
   * Supports Enter to send, ArrowUp/Down to navigate prompt history
   * @param e - Keyboard event from the input field
   */
  const handleKeyPress = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isStreaming && !isExecuting) {
          handleSendMessage()
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (promptHistory.length > 0) {
          const newIndex =
            historyIndex === -1 ? promptHistory.length - 1 : Math.max(0, historyIndex - 1)
          setHistoryIndex(newIndex)
          setChatMessage(promptHistory[newIndex])
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex >= 0) {
          const newIndex = historyIndex + 1
          if (newIndex >= promptHistory.length) {
            setHistoryIndex(-1)
            setChatMessage('')
          } else {
            setHistoryIndex(newIndex)
            setChatMessage(promptHistory[newIndex])
          }
        }
      }
    },
    [handleSendMessage, promptHistory, historyIndex, isStreaming, isExecuting]
  )

  /**
   * Handles output selection changes
   * Deduplicates and stores selected workflow outputs for the current workflow
   * @param values - Array of selected output IDs or labels
   */
  const handleOutputSelection = useCallback(
    (values: string[]) => {
      if (!activeWorkflowId) return

      const dedupedValues = [...new Set(values)]
      setSelectedWorkflowOutput(activeWorkflowId, dedupedValues)
    },
    [activeWorkflowId, setSelectedWorkflowOutput]
  )

  /**
   * Closes the chat modal
   */
  const handleClose = useCallback(() => {
    setIsChatOpen(false)
  }, [setIsChatOpen])

  /**
   * Adds any missing reserved inputs (input, conversationId, files) to the unified start block.
   */
  const handleConfigureStartInputs = useCallback(() => {
    if (!activeWorkflowId || !startBlockId) {
      logger.warn('Cannot configure start inputs: missing active workflow ID or start block ID')
      return
    }

    try {
      const normalizedExisting = normalizeInputFormatValue(startBlockInputFormat)

      const newReservedFields: StartInputFormatField[] = missingStartReservedFields.map(
        (fieldName) => {
          const defaultType = fieldName === 'files' ? 'file[]' : 'string'

          return {
            id: crypto.randomUUID(),
            name: fieldName,
            type: defaultType,
            value: '',
            collapsed: false,
          }
        }
      )

      const updatedFields: StartInputFormatField[] = [...newReservedFields, ...normalizedExisting]

      setSubBlockValue(startBlockId, 'inputFormat', updatedFields)

      const userId = session?.user?.id || 'unknown'
      addToQueue({
        id: crypto.randomUUID(),
        operation: {
          operation: 'subblock-update',
          target: 'subblock',
          payload: {
            blockId: startBlockId,
            subblockId: 'inputFormat',
            value: updatedFields,
          },
        },
        workflowId: activeWorkflowId,
        userId,
      })

      triggerWorkflowUpdate()
    } catch (error) {
      logger.error('Failed to configure start block reserved inputs', error)
    }
  }, [
    activeWorkflowId,
    missingStartReservedFields,
    setSubBlockValue,
    startBlockId,
    startBlockInputFormat,
    triggerWorkflowUpdate,
    session,
    addToQueue,
  ])

  if (!isChatOpen) return null

  return (
    <div
      ref={preventZoomRef}
      className='fixed z-30 flex flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-[10px] pt-[2px] pb-[8px]'
      style={{
        left: `${actualPosition.x}px`,
        top: `${actualPosition.y}px`,
        width: `${chatWidth}px`,
        height: `${chatHeight}px`,
        cursor: resizeCursor || undefined,
      }}
      onMouseMove={handleResizeMouseMove}
      onMouseLeave={handleResizeMouseLeave}
      onMouseDown={handleResizeMouseDown}
    >
      {/* Header with drag handle */}
      <div
        className='flex h-[32px] flex-shrink-0 cursor-grab items-center justify-between gap-[10px] bg-[var(--surface-1)] p-0 active:cursor-grabbing'
        onMouseDown={handleMouseDown}
      >
        <span className='flex-shrink-0 pr-[2px] font-medium text-[14px] text-[var(--text-primary)]'>
          Chat
        </span>

        {/* Start inputs button and output selector - with max-width to prevent overflow */}
        <div
          className='ml-auto flex min-w-0 flex-shrink items-center gap-[6px]'
          onMouseDown={(e) => e.stopPropagation()}
        >
          {shouldShowConfigureStartInputsButton && (
            <div
              className='flex flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[9px] py-[2px] font-medium font-sans text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-7)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]'
              title='Add chat inputs to Start block'
              onMouseDown={(e) => {
                e.stopPropagation()
                handleConfigureStartInputs()
              }}
            >
              <span className='whitespace-nowrap'>Add inputs</span>
            </div>
          )}

          <OutputSelect
            workflowId={activeWorkflowId}
            selectedOutputs={selectedOutputs}
            onOutputSelect={handleOutputSelection}
            disabled={!activeWorkflowId}
            placeholder='Outputs'
            align='end'
            maxHeight={180}
          />
        </div>

        <div className='flex flex-shrink-0 items-center gap-[8px]'>
          {/* More menu with actions */}
          <Popover variant='default' size='sm' open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                className='!p-1.5 -m-1.5'
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className='h-[14px] w-[14px]' strokeWidth={2} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side='bottom'
              align='end'
              sideOffset={8}
              maxHeight={100}
              style={{ width: '110px', minWidth: '110px' }}
            >
              <PopoverScrollArea>
                <PopoverItem
                  onClick={() => {
                    if (activeWorkflowId) exportChatCSV(activeWorkflowId)
                    setMoreMenuOpen(false)
                  }}
                  disabled={workflowMessages.length === 0}
                >
                  <ArrowDownToLine className='h-[13px] w-[13px]' />
                  <span>Download</span>
                </PopoverItem>
                <PopoverItem
                  onClick={() => {
                    if (activeWorkflowId) clearChat(activeWorkflowId)
                    setMoreMenuOpen(false)
                  }}
                  disabled={workflowMessages.length === 0}
                >
                  <Trash className='h-[13px] w-[13px]' />
                  <span>Clear</span>
                </PopoverItem>
              </PopoverScrollArea>
            </PopoverContent>
          </Popover>

          {/* Close button */}
          <Button variant='ghost' className='!p-1.5 -m-1.5' onClick={handleClose}>
            <X className='h-[16px] w-[16px]' />
          </Button>
        </div>
      </div>

      {/* Chat content */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        {/* Messages */}
        <div className='flex-1 overflow-hidden'>
          {workflowMessages.length === 0 ? (
            <div className='flex h-full items-center justify-center text-[#8D8D8D] text-[13px]'>
              No messages yet
            </div>
          ) : (
            <div ref={scrollAreaRef} className='h-full overflow-y-auto overflow-x-hidden'>
              <div className='w-full max-w-full space-y-[8px] overflow-hidden py-[8px]'>
                {workflowMessages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input section */}
        <div
          className='flex-none'
          onDragEnter={!activeWorkflowId || isExecuting ? undefined : handleDragEnter}
          onDragOver={!activeWorkflowId || isExecuting ? undefined : handleDragOver}
          onDragLeave={!activeWorkflowId || isExecuting ? undefined : handleDragLeave}
          onDrop={!activeWorkflowId || isExecuting ? undefined : handleDrop}
        >
          {/* Error messages */}
          {uploadErrors.length > 0 && (
            <div>
              <div className='rounded-lg border border-[#883827] bg-[#491515]'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='mt-0.5 h-3 w-3 shrink-0 text-[var(--text-error)]' />
                  <div className='flex-1'>
                    <div className='mb-1 font-medium text-[12px] text-[var(--text-error)]'>
                      File upload error
                    </div>
                    <div className='space-y-1'>
                      {uploadErrors.map((err, idx) => (
                        <div key={idx} className='text-[10px] text-[var(--text-error)]'>
                          {err}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Combined input container */}
          <div
            className={`rounded-[4px] border bg-[var(--surface-5)] py-0 pr-[6px] pl-[4px] transition-colors ${
              isDragOver ? 'border-[var(--brand-secondary)]' : 'border-[var(--border-1)]'
            }`}
          >
            {/* File thumbnails */}
            {chatFiles.length > 0 && (
              <div className='mt-[4px] flex gap-[6px] overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
                {chatFiles.map((file) => {
                  const previewUrl = getFilePreviewUrl(file)

                  return (
                    <div
                      key={file.id}
                      className={cn(
                        'group relative flex-shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface-2)]',
                        previewUrl
                          ? 'h-[40px] w-[40px]'
                          : 'flex min-w-[80px] max-w-[120px] items-center justify-center px-[8px] py-[2px]'
                      )}
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <div className='min-w-0 flex-1'>
                          <div className='truncate font-medium text-[10px] text-[var(--white)]'>
                            {file.name}
                          </div>
                          <div className='text-[9px] text-[var(--text-tertiary)]'>
                            {formatFileSize(file.size)}
                          </div>
                        </div>
                      )}

                      <Button
                        variant='ghost'
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFile(file.id)
                        }}
                        className='absolute top-0.5 right-0.5 h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-100'
                      >
                        <X className='h-2.5 w-2.5' />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Input field with inline buttons */}
            <div className='relative'>
              <Input
                ref={inputRef}
                value={chatMessage}
                onChange={(e) => {
                  setChatMessage(e.target.value)
                  setHistoryIndex(-1)
                }}
                onKeyDown={handleKeyPress}
                placeholder={isDragOver ? 'Drop files here...' : 'Type a message...'}
                className='w-full border-0 bg-transparent pr-[56px] pl-[4px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0'
                disabled={!activeWorkflowId}
              />

              {/* Buttons positioned absolutely on the right */}
              <div className='-translate-y-1/2 absolute top-1/2 right-[2px] flex items-center gap-[10px]'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Badge
                      onClick={() => document.getElementById('floating-chat-file-input')?.click()}
                      className={cn(
                        '!bg-transparent !border-0 cursor-pointer rounded-[6px] p-[0px]',
                        (!activeWorkflowId || isExecuting || chatFiles.length >= 15) &&
                          'cursor-not-allowed opacity-50'
                      )}
                    >
                      <Paperclip className='!h-3.5 !w-3.5' />
                    </Badge>
                  </Tooltip.Trigger>
                  <Tooltip.Content>Attach file</Tooltip.Content>
                </Tooltip.Root>

                {isStreaming ? (
                  <Button
                    onClick={handleStopStreaming}
                    className='!bg-[var(--c-C0C0C0)] hover:!bg-[var(--c-D0D0D0)] h-[22px] w-[22px] rounded-full p-0 transition-colors'
                  >
                    <Square className='h-2.5 w-2.5 fill-black text-black' />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSendMessage}
                    disabled={
                      (!chatMessage.trim() && chatFiles.length === 0) ||
                      !activeWorkflowId ||
                      isExecuting ||
                      isStreaming
                    }
                    className={cn(
                      'h-[22px] w-[22px] rounded-full p-0 transition-colors',
                      chatMessage.trim() || chatFiles.length > 0
                        ? '!bg-[var(--c-C0C0C0)] hover:!bg-[var(--c-D0D0D0)]'
                        : '!bg-[var(--c-C0C0C0)]'
                    )}
                  >
                    <ArrowUp className='h-3.5 w-3.5 text-black' strokeWidth={2.25} />
                  </Button>
                )}
              </div>
            </div>

            {/* Hidden file input */}
            <input
              id='floating-chat-file-input'
              type='file'
              multiple
              accept='.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.xml,.rtf,image/*'
              onChange={handleFileInputChange}
              className='hidden'
              disabled={!activeWorkflowId || isExecuting}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
