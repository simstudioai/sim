'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowDownToLine, ArrowUp, MoreVertical, Paperclip, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverTrigger,
  Trash,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  parseOutputContentSafely,
} from '@/lib/response-format'
import { cn } from '@/lib/utils'
import { useScrollManagement } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import type { BlockLog, ExecutionResult } from '@/executor/types'
import { getChatPosition, useChatStore } from '@/stores/chat/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { ChatMessage, OutputSelect } from './components'
import { useChatBoundarySync, useChatDrag, useChatFileUpload, useChatResize } from './hooks'

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
 * Reads files and converts them to data URLs for image display
 * @param chatFiles - Array of chat files to process
 * @returns Promise resolving to array of files with data URLs for images
 */
const processFileAttachments = async (chatFiles: any[]) => {
  return Promise.all(
    chatFiles.map(async (file) => {
      let dataUrl = ''
      if (file.type.startsWith('image/')) {
        try {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
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
const extractOutputFromLogs = (logs: BlockLog[] | undefined, outputId: string): any | undefined => {
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
const formatOutputContent = (output: any): string => {
  if (typeof output === 'string') {
    return output
  }
  if (output && typeof output === 'object') {
    return `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``
  }
  return ''
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
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { activeWorkflowId } = useWorkflowRegistry()

  // Chat state (UI and messages from unified store)
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

  const { entries } = useTerminalConsoleStore()
  const { isExecuting } = useExecutionStore()
  const { handleRunWorkflow } = useWorkflowExecution()

  // Local state
  const [chatMessage, setChatMessage] = useState('')
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  // Refs
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // File upload hook
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

  // Get actual position (default if not set)
  const actualPosition = useMemo(
    () => getChatPosition(chatPosition, chatWidth, chatHeight),
    [chatPosition, chatWidth, chatHeight]
  )

  // Drag hook
  const { handleMouseDown } = useChatDrag({
    position: actualPosition,
    width: chatWidth,
    height: chatHeight,
    onPositionChange: setChatPosition,
  })

  // Boundary sync hook - keeps chat within bounds when layout changes
  useChatBoundarySync({
    isOpen: isChatOpen,
    position: actualPosition,
    width: chatWidth,
    height: chatHeight,
    onPositionChange: setChatPosition,
  })

  // Resize hook - enables resizing from all edges and corners
  const {
    cursor: resizeCursor,
    handleMouseMove: handleResizeMouseMove,
    handleMouseLeave: handleResizeMouseLeave,
    handleMouseDown: handleResizeMouseDown,
  } = useChatResize({
    position: actualPosition,
    width: chatWidth,
    height: chatHeight,
    onPositionChange: setChatPosition,
    onDimensionsChange: setChatDimensions,
  })

  // Get output entries from console
  const outputEntries = useMemo(() => {
    if (!activeWorkflowId) return []
    return entries.filter((entry) => entry.workflowId === activeWorkflowId && entry.output)
  }, [entries, activeWorkflowId])

  // Get filtered messages for current workflow
  const workflowMessages = useMemo(() => {
    if (!activeWorkflowId) return []
    return messages
      .filter((msg) => msg.workflowId === activeWorkflowId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [messages, activeWorkflowId])

  // Check if any message is currently streaming
  const isStreaming = useMemo(() => {
    // Match copilot semantics: only treat as streaming if the LAST message is streaming
    const lastMessage = workflowMessages[workflowMessages.length - 1]
    return Boolean(lastMessage?.isStreaming)
  }, [workflowMessages])

  // Map chat messages to copilot message format (type -> role) for scroll hook
  const messagesForScrollHook = useMemo(() => {
    return workflowMessages.map((msg) => ({
      ...msg,
      role: msg.type,
    }))
  }, [workflowMessages])

  // Scroll management hook - reuse copilot's implementation
  const { scrollAreaRef, scrollToBottom } = useScrollManagement(messagesForScrollHook, isStreaming)

  // Memoize user messages for performance
  const userMessages = useMemo(() => {
    return workflowMessages
      .filter((msg) => msg.type === 'user')
      .map((msg) => msg.content)
      .filter((content): content is string => typeof content === 'string')
  }, [workflowMessages])

  // Update prompt history when workflow changes
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
   * Auto-scroll to bottom when messages load
   */
  useEffect(() => {
    if (workflowMessages.length > 0 && isChatOpen) {
      scrollToBottom()
    }
  }, [workflowMessages.length, scrollToBottom, isChatOpen])

  // Get selected workflow outputs (deduplicated)
  const selectedOutputs = useMemo(() => {
    if (!activeWorkflowId) return []
    const selected = selectedWorkflowOutputs[activeWorkflowId]
    return selected && selected.length > 0 ? [...new Set(selected)] : []
  }, [selectedWorkflowOutputs, activeWorkflowId])

  /**
   * Focuses the input field with optional delay
   */
  const focusInput = useCallback((delay = 0) => {
    timeoutRef.current && clearTimeout(timeoutRef.current)

    timeoutRef.current = setTimeout(() => {
      if (inputRef.current && document.contains(inputRef.current)) {
        inputRef.current.focus({ preventScroll: true })
      }
    }, delay)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timeoutRef.current && clearTimeout(timeoutRef.current)
      abortControllerRef.current?.abort()
    }
  }, [])

  /**
   * Processes streaming response from workflow execution
   */
  const processStreamingResponse = useCallback(
    async (stream: ReadableStream, responseMessageId: string) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let accumulatedContent = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            finalizeMessageStream(responseMessageId)
            break
          }

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n\n')

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
        logger.error('Error processing stream:', error)
      } finally {
        focusInput(100)
      }
    },
    [appendMessageContent, finalizeMessageStream, focusInput]
  )

  /**
   * Handles workflow execution response
   */
  const handleWorkflowResponse = useCallback(
    (result: any) => {
      if (!result || !activeWorkflowId) return

      // Handle streaming response
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

      // Handle success with logs
      if ('success' in result && result.success && 'logs' in result) {
        selectedOutputs
          .map((outputId) => extractOutputFromLogs(result.logs, outputId))
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

      // Handle error response
      if ('success' in result && !result.success) {
        const errorMessage = 'error' in result ? result.error : 'Workflow execution failed.'
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
   */
  const handleSendMessage = useCallback(async () => {
    if ((!chatMessage.trim() && chatFiles.length === 0) || !activeWorkflowId || isExecuting) return

    const sentMessage = chatMessage.trim()

    // Update prompt history (only if new unique message)
    if (sentMessage && promptHistory[promptHistory.length - 1] !== sentMessage) {
      setPromptHistory((prev) => [...prev, sentMessage])
    }
    setHistoryIndex(-1)

    // Reset abort controller
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    const conversationId = getConversationId(activeWorkflowId)

    try {
      // Process file attachments
      const attachmentsWithData = await processFileAttachments(chatFiles)

      // Add user message
      const messageContent =
        sentMessage || (chatFiles.length > 0 ? `Uploaded ${chatFiles.length} file(s)` : '')
      addMessage({
        content: messageContent,
        workflowId: activeWorkflowId,
        type: 'user',
        attachments: attachmentsWithData,
      })

      // Prepare workflow input
      const workflowInput: any = {
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

      // Clear input and files
      setChatMessage('')
      clearFiles()
      clearErrors()
      focusInput(10)

      // Execute workflow
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
   */
  const handleKeyPress = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
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
    [handleSendMessage, promptHistory, historyIndex]
  )

  /**
   * Handles output selection changes
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

  // Don't render if not open
  if (!isChatOpen) return null

  return (
    <div
      className='fixed z-30 flex flex-col overflow-hidden rounded-[6px] bg-[var(--surface-1)] px-[10px] pt-[2px] pb-[8px]'
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
        className='flex h-[32px] flex-shrink-0 cursor-grab items-center justify-between bg-[var(--surface-1)] p-0 active:cursor-grabbing'
        onMouseDown={handleMouseDown}
      >
        <div className='flex items-center'>
          <span className='flex-shrink-0 font-medium text-[14px] text-[var(--text-primary)]'>
            Chat
          </span>
        </div>

        {/* Output selector - centered with mx-auto */}
        <div className='mr-[6px] ml-auto' onMouseDown={(e) => e.stopPropagation()}>
          <OutputSelect
            workflowId={activeWorkflowId}
            selectedOutputs={selectedOutputs}
            onOutputSelect={handleOutputSelection}
            disabled={!activeWorkflowId}
            placeholder='Select outputs'
          />
        </div>

        <div className='flex items-center gap-[8px]'>
          {/* More menu with actions */}
          <Popover variant='default'>
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
              style={{ width: '110px', minWidth: '110px' }}
            >
              <PopoverScrollArea>
                <PopoverItem
                  onClick={(e) => {
                    e.stopPropagation()
                    if (activeWorkflowId) exportChatCSV(activeWorkflowId)
                  }}
                  disabled={messages.length === 0}
                >
                  <ArrowDownToLine className='h-[14px] w-[14px]' />
                  <span>Download</span>
                </PopoverItem>
                <PopoverItem
                  onClick={(e) => {
                    e.stopPropagation()
                    if (activeWorkflowId) clearChat(activeWorkflowId)
                  }}
                  disabled={messages.length === 0}
                >
                  <Trash className='h-[14px] w-[14px]' />
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
                    <div className='mb-1 font-medium text-[11px] text-[var(--text-error)]'>
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
            className={`rounded-[4px] border bg-[var(--surface-9)] py-0 pr-[6px] pl-[4px] transition-colors ${
              isDragOver ? 'border-[var(--brand-secondary)]' : 'border-[var(--surface-11)]'
            }`}
          >
            {/* File thumbnails */}
            {chatFiles.length > 0 && (
              <div className='mt-[4px] flex gap-[6px] overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
                {chatFiles.map((file) => {
                  const isImage = file.type.startsWith('image/')
                  const previewUrl = isImage ? URL.createObjectURL(file.file) : null

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
                          onLoad={() => URL.revokeObjectURL(previewUrl)}
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
                disabled={!activeWorkflowId || isExecuting}
              />

              {/* Buttons positioned absolutely on the right */}
              <div className='-translate-y-1/2 absolute top-1/2 right-[2px] flex items-center gap-[10px]'>
                <Badge
                  onClick={() => document.getElementById('floating-chat-file-input')?.click()}
                  title='Attach file'
                  className={cn(
                    '!bg-transparent cursor-pointer rounded-[6px] p-[0px]',
                    (!activeWorkflowId || isExecuting || chatFiles.length >= 15) &&
                      'cursor-not-allowed opacity-50'
                  )}
                >
                  <Paperclip className='!h-3.5 !w-3.5' />
                </Badge>

                <Button
                  onClick={handleSendMessage}
                  disabled={
                    (!chatMessage.trim() && chatFiles.length === 0) ||
                    !activeWorkflowId ||
                    isExecuting
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
