'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console/logger'
import {
  extractBlockIdFromOutputId,
  extractPathFromOutputId,
  parseOutputContentSafely,
} from '@/lib/response-format'
import { ChatMessage } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/chat/components/chat-message/chat-message'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/chat/components/output-select/output-select'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import type { BlockLog, ExecutionResult } from '@/executor/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { ChatFileUpload } from './components/chat-file-upload'

const logger = createLogger('ChatPanel')

interface ChatFile {
  id: string
  name: string
  size: number
  type: string
  file: File
}

interface ChatProps {
  panelWidth: number
  chatMessage: string
  setChatMessage: (message: string) => void
}

export function Chat({ panelWidth, chatMessage, setChatMessage }: ChatProps) {
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
      // Add user message
      addMessage({
        content:
          sentMessage || (chatFiles.length > 0 ? `Uploaded ${chatFiles.length} file(s)` : ''),
        workflowId: activeWorkflowId,
        type: 'user',
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
      }

      // Clear input and files, refocus immediately
      setChatMessage('')
      setChatFiles([])
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
      const messageIdMap = new Map<string, string>()

      const reader = result.stream.getReader()
      const decoder = new TextDecoder()

      const processStream = async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // Finalize all streaming messages
            messageIdMap.forEach((id) => finalizeMessageStream(id))
            break
          }

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.substring(6))
                const { blockId, chunk: contentChunk, event, data } = json

                if (event === 'final' && data) {
                  const result = data as ExecutionResult
                  const nonStreamingLogs =
                    result.logs?.filter((log) => !messageIdMap.has(log.blockId)) || []

                  if (nonStreamingLogs.length > 0) {
                    const outputsToRender = selectedOutputs.filter((outputId) => {
                      const blockIdForOutput = extractBlockIdFromOutputId(outputId)
                      return nonStreamingLogs.some((log) => log.blockId === blockIdForOutput)
                    })

                    for (const outputId of outputsToRender) {
                      const blockIdForOutput = extractBlockIdFromOutputId(outputId)
                      const path = extractPathFromOutputId(outputId, blockIdForOutput)
                      const log = nonStreamingLogs.find((l) => l.blockId === blockIdForOutput)

                      if (log) {
                        let outputValue: any = log.output

                        if (path) {
                          // Parse JSON content safely
                          outputValue = parseOutputContentSafely(outputValue)

                          const pathParts = path.split('.')
                          for (const part of pathParts) {
                            if (
                              outputValue &&
                              typeof outputValue === 'object' &&
                              part in outputValue
                            ) {
                              outputValue = outputValue[part]
                            } else {
                              outputValue = undefined
                              break
                            }
                          }
                        }
                        if (outputValue !== undefined) {
                          addMessage({
                            content:
                              typeof outputValue === 'string'
                                ? outputValue
                                : `\`\`\`json\n${JSON.stringify(outputValue, null, 2)}\n\`\`\``,
                            workflowId: activeWorkflowId,
                            type: 'workflow',
                          })
                        }
                      }
                    }
                  }
                } else if (blockId && contentChunk) {
                  if (!messageIdMap.has(blockId)) {
                    const newMessageId = crypto.randomUUID()
                    messageIdMap.set(blockId, newMessageId)
                    addMessage({
                      id: newMessageId,
                      content: contentChunk,
                      workflowId: activeWorkflowId,
                      type: 'workflow',
                      isStreaming: true,
                    })
                  } else {
                    const existingMessageId = messageIdMap.get(blockId)
                    if (existingMessageId) {
                      appendMessageContent(existingMessageId, contentChunk)
                    }
                  }
                } else if (blockId && event === 'end') {
                  const existingMessageId = messageIdMap.get(blockId)
                  if (existingMessageId) {
                    finalizeMessageStream(existingMessageId)
                  }
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
            <ScrollArea ref={scrollAreaRef} className='h-full pb-2' hideScrollbar={true}>
              <div>
                {workflowMessages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
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
                const newFiles = droppedFiles.slice(0, 5 - chatFiles.length).map((file) => ({
                  id: crypto.randomUUID(),
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  file,
                }))
                setChatFiles([...chatFiles, ...newFiles])
              }
            }
          }}
        >
          {/* File upload section */}
          <div className='mb-2'>
            <ChatFileUpload
              files={chatFiles}
              onFilesChange={setChatFiles}
              maxFiles={5}
              maxSize={10}
              disabled={!activeWorkflowId || isExecuting || isUploadingFiles}
            />
          </div>

          <div className='flex gap-2'>
            <Input
              ref={inputRef}
              value={chatMessage}
              onChange={(e) => {
                setChatMessage(e.target.value)
                setHistoryIndex(-1) // Reset history index when typing
              }}
              onKeyDown={handleKeyPress}
              placeholder={isDragOver ? 'Drop files here...' : 'Type a message...'}
              className={`h-9 flex-1 rounded-lg border-[#E5E5E5] bg-[#FFFFFF] text-muted-foreground shadow-xs focus-visible:ring-0 focus-visible:ring-offset-0 dark:border-[#414141] dark:bg-[var(--surface-elevated)] ${
                isDragOver
                  ? 'border-[var(--brand-primary-hover-hex)] bg-purple-50/50 dark:border-[var(--brand-primary-hover-hex)] dark:bg-purple-950/20'
                  : ''
              }`}
              disabled={!activeWorkflowId || isExecuting || isUploadingFiles}
            />
            <Button
              onClick={handleSendMessage}
              size='icon'
              disabled={
                (!chatMessage.trim() && chatFiles.length === 0) ||
                !activeWorkflowId ||
                isExecuting ||
                isUploadingFiles
              }
              className='h-9 w-9 rounded-lg bg-[var(--brand-primary-hover-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hover-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
            >
              <ArrowUp className='h-4 w-4' />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
