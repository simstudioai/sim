'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
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
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Prompt history state
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

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

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [workflowMessages])

  // Handle send message
  const handleSendMessage = useCallback(async () => {
    if (!chatMessage.trim() || !activeWorkflowId || isExecuting) return

    // Store the message being sent for reference
    const sentMessage = chatMessage.trim()

    // Add to prompt history if it's not already the most recent
    if (promptHistory.length === 0 || promptHistory[promptHistory.length - 1] !== sentMessage) {
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

    // Add user message
    addMessage({
      content: sentMessage,
      workflowId: activeWorkflowId,
      type: 'user',
    })

    // Clear input and refocus immediately
    setChatMessage('')
    focusInput(10)

    // Execute the workflow to generate a response, passing the chat message and conversationId as input
    const result = await handleRunWorkflow({
      input: sentMessage,
      conversationId: conversationId,
    })

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
            <ScrollArea className='h-full pb-2' hideScrollbar={true}>
              <div>
                {workflowMessages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Input section - Fixed height */}
        <div className='-mt-[1px] relative flex-nonept-3 pb-4'>
          <div className='flex gap-2'>
            <Input
              ref={inputRef}
              value={chatMessage}
              onChange={(e) => {
                setChatMessage(e.target.value)
                setHistoryIndex(-1) // Reset history index when typing
              }}
              onKeyDown={handleKeyPress}
              placeholder='Type a message...'
              className='h-9 flex-1 rounded-lg border-[#E5E5E5] bg-[#FFFFFF] text-muted-foreground shadow-xs focus-visible:ring-0 focus-visible:ring-offset-0 dark:border-[#414141] dark:bg-[#202020]'
              disabled={!activeWorkflowId || isExecuting}
            />
            <Button
              onClick={handleSendMessage}
              size='icon'
              disabled={!chatMessage.trim() || !activeWorkflowId || isExecuting}
              className='h-9 w-9 rounded-lg bg-[#802FFF] text-white shadow-[0_0_0_0_#802FFF] transition-all duration-200 hover:bg-[#7028E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
            >
              <ArrowUp className='h-4 w-4' />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
