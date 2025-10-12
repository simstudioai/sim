'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, File, FileText, Image, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  parseOutputContentSafely,
} from '@/lib/response-format'
import {
  ChatMessage,
  OutputSelect,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/chat/components'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import type { BlockLog, ExecutionResult } from '@/executor/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('ChatPanel')

interface ChatFile {
  id: string
  name: string
  size: number
  type: string
  file: File
}

interface ChatProps {
  chatMessage: string
  setChatMessage: (message: string) => void
}

export function Chat({ chatMessage, setChatMessage }: ChatProps) {
  const { activeWorkflowId } = useWorkflowRegistry()

  const {
    messages,
    addMessage,
    selectedWorkflowOutputs,
    setSelectedWorkflowOutput,
    appendMessageContent,
    finalizeMessageStream,
    getConversationId,
  } = useChatStore()
  const { entries } = useConsoleStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Prompt history state
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  // File upload state
  const [chatFiles, setChatFiles] = useState<ChatFile[]>([])
  const [isUploadingFiles, setIsUploadingFiles] = useState(false)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [dragCounter, setDragCounter] = useState(0)
  const isDragOver = dragCounter > 0
  // Scroll state
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  // Use the execution store state to track if a workflow is executing
  const { isExecuting } = useExecutionStore()

  // Get workflow execution functionality
  const { handleRunWorkflow } = useWorkflowExecution()

  // Get output entries from console for the dropdown
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

  // Get selected workflow outputs
  const selectedOutputs = useMemo(() => {
    if (!activeWorkflowId) return []
    const selected = selectedWorkflowOutputs[activeWorkflowId]

    if (!selected || selected.length === 0) {
      // Return empty array when nothing is explicitly selected
      return []
    }

    // Ensure we have no duplicates in the selection
    const dedupedSelection = [...new Set(selected)]

    // If deduplication removed items, update the store
    if (dedupedSelection.length !== selected.length) {
      setSelectedWorkflowOutput(activeWorkflowId, dedupedSelection)
      return dedupedSelection
    }

    return selected
  }, [selectedWorkflowOutputs, activeWorkflowId, setSelectedWorkflowOutput])

  // Focus input helper with proper cleanup
  const focusInput = useCallback((delay = 0) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      if (inputRef.current && document.contains(inputRef.current)) {
        inputRef.current.focus({ preventScroll: true })
      }
    }, delay)
  }, [])

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Find the viewport element inside the ScrollArea
    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // Consider "near bottom" if within 100px of bottom
    const nearBottom = distanceFromBottom <= 100
    setIsNearBottom(nearBottom)
    setShowScrollButton(!nearBottom)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  // Attach scroll listener
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Find the viewport element inside the ScrollArea
    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    viewport.addEventListener('scroll', handleScroll, { passive: true })

    // Also listen for scrollend event if available (for smooth scrolling)
    if ('onscrollend' in viewport) {
      viewport.addEventListener('scrollend', handleScroll, { passive: true })
    }

    // Initial scroll state check with small delay to ensure DOM is ready
    setTimeout(handleScroll, 100)

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      if ('onscrollend' in viewport) {
        viewport.removeEventListener('scrollend', handleScroll)
      }
    }
  }, [handleScroll])

  // Auto-scroll to bottom when new messages are added, but only if user is near bottom
  // Exception: Always scroll when sending a new message
  useEffect(() => {
    if (workflowMessages.length === 0) return

    const lastMessage = workflowMessages[workflowMessages.length - 1]
    const isNewUserMessage = lastMessage?.type === 'user'

    // Always scroll for new user messages, or only if near bottom for assistant messages
    if ((isNewUserMessage || isNearBottom) && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
      // Let the scroll event handler update the state naturally after animation completes
    }
  }, [workflowMessages, isNearBottom])

  // Handle send message
  const handleSendMessage = useCallback(async () => {
    if (
      (!chatMessage.trim() && chatFiles.length === 0) ||
      !activeWorkflowId ||
      isExecuting ||
      isUploadingFiles
    )
      return

    // Store the message being sent for reference
    const sentMessage = chatMessage.trim()

    // Add to prompt history if it's not already the most recent
    if (
      sentMessage &&
      (promptHistory.length === 0 || promptHistory[promptHistory.length - 1] !== sentMessage)
    ) {
      setPromptHistory((prev) => [...prev, sentMessage])
    }

    // Reset history index
    setHistoryIndex(-1)

    // Cancel any existing operations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    // Get the conversationId for this workflow before adding the message
    const conversationId = getConversationId(activeWorkflowId)
    let result: any = null

    try {
      // Read files as data URLs for display in chat (only images to avoid localStorage quota issues)
      const attachmentsWithData = await Promise.all(
        chatFiles.map(async (file) => {
          let dataUrl = ''
          // Only read images as data URLs to avoid storing large files in localStorage
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

      // Add user message with attachments (include all files, even non-images without dataUrl)
      addMessage({
        content:
          sentMessage || (chatFiles.length > 0 ? `Uploaded ${chatFiles.length} file(s)` : ''),
        workflowId: activeWorkflowId,
        type: 'user',
        attachments: attachmentsWithData,
      })

      // Prepare workflow input
      const workflowInput: any = {
        input: sentMessage,
        conversationId: conversationId,
      }

      // Add files if any (pass the File objects directly)
      if (chatFiles.length > 0) {
        workflowInput.files = chatFiles.map((chatFile) => ({
          name: chatFile.name,
          size: chatFile.size,
          type: chatFile.type,
          file: chatFile.file, // Pass the actual File object
        }))
        workflowInput.onUploadError = (message: string) => {
          setUploadErrors((prev) => [...prev, message])
        }
      }

      // Clear input and files, refocus immediately
      setChatMessage('')
      setChatFiles([])
      setUploadErrors([])
      focusInput(10)

      // Execute the workflow to generate a response
      result = await handleRunWorkflow(workflowInput)
    } catch (error) {
      logger.error('Error in handleSendMessage:', error)
      setIsUploadingFiles(false)
      // You might want to show an error message to the user here
      return
    }

    // Check if we got a streaming response
    if (result && 'stream' in result && result.stream instanceof ReadableStream) {
      // Create a single message for all outputs (like chat client does)
      const responseMessageId = crypto.randomUUID()
      let accumulatedContent = ''

      // Add initial streaming message
      addMessage({
        id: responseMessageId,
        content: '',
        workflowId: activeWorkflowId,
        type: 'workflow',
        isStreaming: true,
      })

      const reader = result.stream.getReader()
      const decoder = new TextDecoder()

      const processStream = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // Finalize the streaming message
            finalizeMessageStream(responseMessageId)
            break
          }

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6)

              if (data === '[DONE]') {
                continue
              }

              try {
                const json = JSON.parse(data)
                const { blockId, chunk: contentChunk, event, data: eventData } = json

                if (event === 'final' && eventData) {
                  const result = eventData as ExecutionResult

                  // If final result is a failure, surface error and stop
                  if ('success' in result && !result.success) {
                    // Update the existing message with error
                    appendMessageContent(
                      responseMessageId,
                      `${accumulatedContent ? '\n\n' : ''}Error: ${result.error || 'Workflow execution failed'}`
                    )
                    finalizeMessageStream(responseMessageId)

                    // Stop processing
                    return
                  }

                  // Final event just marks completion, content already streamed
                  finalizeMessageStream(responseMessageId)
                } else if (blockId && contentChunk) {
                  // Accumulate all content into the single message
                  accumulatedContent += contentChunk
                  appendMessageContent(responseMessageId, contentChunk)
                }
              } catch (e) {
                logger.error('Error parsing stream data:', e)
              }
            }
          }
        }
      }

      processStream()
        .catch((e) => logger.error('Error processing stream:', e))
        .finally(() => {
          // Restore focus after streaming completes
          focusInput(100)
        })
    } else if (result && 'success' in result && result.success && 'logs' in result) {
      const finalOutputs: any[] = []

      if (selectedOutputs?.length > 0) {
        for (const outputId of selectedOutputs) {
          const blockIdForOutput = extractBlockIdFromOutputId(outputId)
          const path = extractPathFromOutputId(outputId, blockIdForOutput)
          const log = result.logs?.find((l: BlockLog) => l.blockId === blockIdForOutput)

          if (log) {
            let output = log.output

            if (path) {
              // Parse JSON content safely
              output = parseOutputContentSafely(output)

              const pathParts = path.split('.')
              let current = output
              for (const part of pathParts) {
                if (current && typeof current === 'object' && part in current) {
                  current = current[part]
                } else {
                  current = undefined
                  break
                }
              }
              output = current
            }
            if (output !== undefined) {
              finalOutputs.push(output)
            }
          }
        }
      }

      // Only show outputs if something was explicitly selected
      // If no outputs are selected, don't show anything

      // Add a new message for each resolved output
      finalOutputs.forEach((output) => {
        let content = ''
        if (typeof output === 'string') {
          content = output
        } else if (output && typeof output === 'object') {
          // For structured responses, pretty print the JSON
          content = `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\``
        }

        if (content) {
          addMessage({
            content,
            workflowId: activeWorkflowId,
            type: 'workflow',
          })
        }
      })
    } else if (result && 'success' in result && !result.success) {
      addMessage({
        content: `Error: ${'error' in result ? result.error : 'Workflow execution failed.'}`,
        workflowId: activeWorkflowId,
        type: 'workflow',
      })
    }

    // Restore focus after workflow execution completes
    focusInput(100)
  }, [
    chatMessage,
    activeWorkflowId,
    isExecuting,
    promptHistory,
    getConversationId,
    addMessage,
    handleRunWorkflow,
    selectedOutputs,
    setSelectedWorkflowOutput,
    appendMessageContent,
    finalizeMessageStream,
    focusInput,
  ])

  // Handle key press
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
    [handleSendMessage, promptHistory, historyIndex, setChatMessage]
  )

  // Handle output selection
  const handleOutputSelection = useCallback(
    (values: string[]) => {
      // Ensure no duplicates in selection
      const dedupedValues = [...new Set(values)]

      if (activeWorkflowId) {
        // If array is empty, explicitly set to empty array to ensure complete reset
        if (dedupedValues.length === 0) {
          setSelectedWorkflowOutput(activeWorkflowId, [])
        } else {
          setSelectedWorkflowOutput(activeWorkflowId, dedupedValues)
        }
      }
    },
    [activeWorkflowId, setSelectedWorkflowOutput]
  )

  return (
    <div className='flex h-full flex-col'>
      {/* Output Source Dropdown */}
      <div className='flex-none py-2'>
        <OutputSelect
          workflowId={activeWorkflowId}
          selectedOutputs={selectedOutputs}
          onOutputSelect={handleOutputSelection}
          disabled={!activeWorkflowId}
          placeholder='Select output sources'
        />
      </div>

      {/* Main layout with fixed heights to ensure input stays visible */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        {/* Chat messages section - Scrollable area */}
        <div className='flex-1 overflow-hidden'>
          {workflowMessages.length === 0 ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              No messages yet
            </div>
          ) : (
            <div ref={scrollAreaRef} className='h-full'>
              <ScrollArea className='h-full pb-2' hideScrollbar={true}>
                <div>
                  {workflowMessages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Scroll to bottom button */}
          {showScrollButton && (
            <div className='-translate-x-1/2 absolute bottom-20 left-1/2 z-10'>
              <Button
                onClick={scrollToBottom}
                size='sm'
                variant='outline'
                className='flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 shadow-lg transition-all hover:bg-gray-50'
              >
                <ArrowDown className='h-3.5 w-3.5' />
                <span className='sr-only'>Scroll to bottom</span>
              </Button>
            </div>
          )}
        </div>

        {/* Input section - Fixed height */}
        <div
          className='-mt-[1px] relative flex-none pt-3 pb-4'
          onDragEnter={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!(!activeWorkflowId || isExecuting || isUploadingFiles)) {
              setDragCounter((prev) => prev + 1)
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!(!activeWorkflowId || isExecuting || isUploadingFiles)) {
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragCounter((prev) => Math.max(0, prev - 1))
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragCounter(0)
            if (!(!activeWorkflowId || isExecuting || isUploadingFiles)) {
              const droppedFiles = Array.from(e.dataTransfer.files)
              if (droppedFiles.length > 0) {
                const remainingSlots = Math.max(0, 5 - chatFiles.length)
                const candidateFiles = droppedFiles.slice(0, remainingSlots)
                const errors: string[] = []
                const validNewFiles: ChatFile[] = []

                for (const file of candidateFiles) {
                  if (file.size > 10 * 1024 * 1024) {
                    errors.push(`${file.name} is too large (max 10MB)`)
                    continue
                  }

                  const isDuplicate = chatFiles.some(
                    (existingFile) =>
                      existingFile.name === file.name && existingFile.size === file.size
                  )
                  if (isDuplicate) {
                    errors.push(`${file.name} already added`)
                    continue
                  }

                  validNewFiles.push({
                    id: crypto.randomUUID(),
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    file,
                  })
                }

                if (errors.length > 0) {
                  setUploadErrors(errors)
                }

                if (validNewFiles.length > 0) {
                  setChatFiles([...chatFiles, ...validNewFiles])
                  setUploadErrors([]) // Clear errors when files are successfully added
                }
              }
            }
          }}
        >
          {/* Error messages */}
          {uploadErrors.length > 0 && (
            <div className='mb-2'>
              <div className='rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800/50 dark:bg-red-950/20'>
                <div className='flex items-start gap-2'>
                  <AlertCircle className='mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400' />
                  <div className='flex-1'>
                    <div className='mb-1 font-medium text-red-800 text-sm dark:text-red-300'>
                      File upload error
                    </div>
                    <div className='space-y-1'>
                      {uploadErrors.map((err, idx) => (
                        <div key={idx} className='text-red-700 text-sm dark:text-red-400'>
                          {err}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Combined input container matching copilot style */}
          <div
            className={`rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] p-2 shadow-xs transition-all duration-200 dark:border-[#414141] dark:bg-[var(--surface-elevated)] ${
              isDragOver
                ? 'border-[var(--brand-primary-hover-hex)] bg-purple-50/50 dark:border-[var(--brand-primary-hover-hex)] dark:bg-purple-950/20'
                : ''
            }`}
          >
            {/* File thumbnails */}
            {chatFiles.length > 0 && (
              <div className='mb-2 flex flex-wrap gap-1.5'>
                {chatFiles.map((file) => {
                  const isImage = file.type.startsWith('image/')
                  let previewUrl: string | null = null
                  if (isImage) {
                    const blobUrl = URL.createObjectURL(file.file)
                    if (blobUrl.startsWith('blob:')) {
                      previewUrl = blobUrl
                    }
                  }
                  const getFileIcon = (type: string) => {
                    if (type.includes('pdf'))
                      return <FileText className='h-5 w-5 text-muted-foreground' />
                    if (type.startsWith('image/'))
                      return <Image className='h-5 w-5 text-muted-foreground' />
                    if (type.includes('text') || type.includes('json'))
                      return <FileText className='h-5 w-5 text-muted-foreground' />
                    return <File className='h-5 w-5 text-muted-foreground' />
                  }
                  const formatFileSize = (bytes: number) => {
                    if (bytes === 0) return '0 B'
                    const k = 1024
                    const sizes = ['B', 'KB', 'MB', 'GB']
                    const i = Math.floor(Math.log(bytes) / Math.log(k))
                    return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
                  }

                  return (
                    <div
                      key={file.id}
                      className={`group relative overflow-hidden rounded-md border border-border/50 bg-muted/20 ${
                        previewUrl
                          ? 'h-16 w-16'
                          : 'flex h-16 min-w-[120px] max-w-[200px] items-center gap-2 px-2'
                      }`}
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={file.name}
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <>
                          <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-background/50'>
                            {getFileIcon(file.type)}
                          </div>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate font-medium text-foreground text-xs'>
                              {file.name}
                            </div>
                            <div className='text-[10px] text-muted-foreground'>
                              {formatFileSize(file.size)}
                            </div>
                          </div>
                        </>
                      )}

                      {/* Remove button */}
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={(e) => {
                          e.stopPropagation()
                          if (previewUrl) URL.revokeObjectURL(previewUrl)
                          setChatFiles(chatFiles.filter((f) => f.id !== file.id))
                        }}
                        className='absolute top-0.5 right-0.5 h-5 w-5 bg-gray-800/80 p-0 text-white opacity-0 transition-opacity hover:bg-gray-800/80 hover:text-white group-hover:opacity-100 dark:bg-black/70 dark:hover:bg-black/70 dark:hover:text-white'
                      >
                        <X className='h-3 w-3' />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Input row */}
            <div className='flex items-center gap-1'>
              {/* Attach button */}
              <Button
                variant='ghost'
                size='icon'
                onClick={() => document.getElementById('chat-file-input')?.click()}
                disabled={
                  !activeWorkflowId || isExecuting || isUploadingFiles || chatFiles.length >= 5
                }
                className='h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground'
                title='Attach files'
              >
                <Paperclip className='h-3 w-3' />
              </Button>

              {/* Hidden file input */}
              <input
                id='chat-file-input'
                type='file'
                multiple
                onChange={(e) => {
                  const files = e.target.files
                  if (!files) return

                  const newFiles: ChatFile[] = []
                  const errors: string[] = []
                  for (let i = 0; i < files.length; i++) {
                    if (chatFiles.length + newFiles.length >= 5) {
                      errors.push('Maximum 5 files allowed')
                      break
                    }
                    const file = files[i]
                    if (file.size > 10 * 1024 * 1024) {
                      errors.push(`${file.name} is too large (max 10MB)`)
                      continue
                    }

                    // Check for duplicates
                    const isDuplicate = chatFiles.some(
                      (existingFile) =>
                        existingFile.name === file.name && existingFile.size === file.size
                    )
                    if (isDuplicate) {
                      errors.push(`${file.name} already added`)
                      continue
                    }

                    newFiles.push({
                      id: crypto.randomUUID(),
                      name: file.name,
                      size: file.size,
                      type: file.type,
                      file,
                    })
                  }
                  if (errors.length > 0) setUploadErrors(errors)
                  if (newFiles.length > 0) {
                    setChatFiles([...chatFiles, ...newFiles])
                    setUploadErrors([]) // Clear errors when files are successfully added
                  }
                  e.target.value = ''
                }}
                className='hidden'
                disabled={!activeWorkflowId || isExecuting || isUploadingFiles}
              />

              {/* Text input */}
              <Input
                ref={inputRef}
                value={chatMessage}
                onChange={(e) => {
                  setChatMessage(e.target.value)
                  setHistoryIndex(-1)
                }}
                onKeyDown={handleKeyPress}
                placeholder={isDragOver ? 'Drop files here...' : 'Type a message...'}
                className='h-8 flex-1 border-0 bg-transparent font-sans text-foreground text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                disabled={!activeWorkflowId || isExecuting || isUploadingFiles}
              />

              {/* Send button */}
              <Button
                onClick={handleSendMessage}
                size='icon'
                disabled={
                  (!chatMessage.trim() && chatFiles.length === 0) ||
                  !activeWorkflowId ||
                  isExecuting ||
                  isUploadingFiles
                }
                className='h-6 w-6 shrink-0 rounded-full bg-[var(--brand-primary-hover-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hover-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
              >
                <ArrowUp className='h-3 w-3' />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
