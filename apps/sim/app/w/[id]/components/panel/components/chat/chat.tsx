'use client'

import { KeyboardEvent, useEffect, useMemo, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { BlockLog } from '@/executor/types'
import { calculateCost } from '@/providers/utils'
import { useWorkflowExecution } from '../../../../hooks/use-workflow-execution'
import { ChatMessage } from './components/chat-message/chat-message'
import { OutputSelect } from './components/output-select/output-select'

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
  } = useChatStore()
  const { entries } = useConsoleStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)

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

  // Get selected workflow outputs
  const selectedOutputs = useMemo(() => {
    if (!activeWorkflowId) return []
    const selected = selectedWorkflowOutputs[activeWorkflowId]

    if (!selected || selected.length === 0) {
      const defaultSelection = outputEntries.length > 0 ? [outputEntries[0].id] : []
      return defaultSelection
    }

    // Ensure we have no duplicates in the selection
    const dedupedSelection = [...new Set(selected)]

    // If deduplication removed items, update the store
    if (dedupedSelection.length !== selected.length) {
      setSelectedWorkflowOutput(activeWorkflowId, dedupedSelection)
      return dedupedSelection
    }

    return selected
  }, [selectedWorkflowOutputs, activeWorkflowId, outputEntries, setSelectedWorkflowOutput])

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [workflowMessages])

  // Handle send message
  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !activeWorkflowId || isExecuting) return

    // Store the message being sent for reference
    const sentMessage = chatMessage.trim()

    // Add user message
    addMessage({
      content: sentMessage,
      workflowId: activeWorkflowId,
      type: 'user',
    })

    // Clear input
    setChatMessage('')

    // Execute the workflow to generate a response, passing the chat message as input
    const result = await handleRunWorkflow({ input: sentMessage })

    // Check if we got a streaming response
    if (result && 'stream' in result && result.stream instanceof ReadableStream) {
      // Generate a unique ID for the message
      const messageId = crypto.randomUUID()

      // Create a content buffer to collect initial content
      let initialContent = ''
      let fullContent = '' // Store the complete content for updating logs later
      let hasAddedMessage = false
      let executionResult = (result as any).execution // Store the execution result with type assertion

      try {
        // Process the stream
        const reader = result.stream.getReader()
        const decoder = new TextDecoder()

        console.log('Starting to read from stream')

        while (true) {
          try {
            const { done, value } = await reader.read()
            if (done) {
              console.log('Stream complete')
              break
            }

            // Decode and append chunk
            const chunk = decoder.decode(value, { stream: true }) // Use stream option

            if (chunk) {
              initialContent += chunk
              fullContent += chunk

              // Only add the message to UI once we have some actual content to show
              if (!hasAddedMessage && initialContent.trim().length > 0) {
                // Add message with initial content - cast to any to bypass type checking for id
                addMessage({
                  content: initialContent,
                  workflowId: activeWorkflowId,
                  type: 'workflow',
                  isStreaming: true,
                  id: messageId,
                } as any)
                hasAddedMessage = true
              } else if (hasAddedMessage) {
                // Append to existing message
                appendMessageContent(messageId, chunk)
              }
            }
          } catch (streamError) {
            console.error('Error reading from stream:', streamError)
            // Break the loop on error
            break
          }
        }

        // If we never added a message (no content received), add it now
        if (!hasAddedMessage && initialContent.trim().length > 0) {
          addMessage({
            content: initialContent,
            workflowId: activeWorkflowId,
            type: 'workflow',
            id: messageId,
          } as any)
        }

        // Update logs with the full streaming content if available
        if (executionResult && fullContent.trim().length > 0) {
          try {
            // Format the final content properly to match what's shown for manual executions
            // Include all the markdown and formatting from the streamed response
            const formattedContent = fullContent

            // Calculate cost based on token usage if available
            let costData = undefined

            if (executionResult.output?.response?.tokens) {
              const tokens = executionResult.output.response.tokens
              const model = executionResult.output?.response?.model || 'gpt-4o'
              const cost = calculateCost(
                model,
                tokens.prompt || 0,
                tokens.completion || 0,
                false // Don't use cached input for chat responses
              )
              costData = { ...cost, model } as any
            }

            // Build trace spans and total duration before persisting
            const { traceSpans, totalDuration } = buildTraceSpans(executionResult as any)

            // Create a completed execution ID
            const completedExecutionId =
              executionResult.metadata?.executionId || crypto.randomUUID()

            // Import the workflow execution hook for direct access to the workflow service
            const workflowExecutionApi = await fetch(`/api/workflows/${activeWorkflowId}/log`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                executionId: completedExecutionId,
                result: {
                  ...executionResult,
                  output: {
                    ...executionResult.output,
                    response: {
                      ...executionResult.output?.response,
                      content: formattedContent,
                      model: executionResult.output?.response?.model,
                      tokens: executionResult.output?.response?.tokens,
                      toolCalls: executionResult.output?.response?.toolCalls,
                      providerTiming: executionResult.output?.response?.providerTiming,
                      cost: costData || executionResult.output?.response?.cost,
                    },
                  },
                  cost: costData,
                  // Update the message to include the formatted content
                  logs: (executionResult.logs || []).map((log: BlockLog) => {
                    // Check if this is the streaming block by comparing with the selected output IDs
                    // Selected output IDs typically include the block ID we are streaming from
                    const isStreamingBlock = selectedOutputs.some(
                      (outputId) =>
                        outputId === log.blockId || outputId.startsWith(`${log.blockId}_`)
                    )

                    if (isStreamingBlock && log.blockType === 'agent' && log.output?.response) {
                      return {
                        ...log,
                        output: {
                          ...log.output,
                          response: {
                            ...log.output.response,
                            content: formattedContent,
                            providerTiming: log.output.response.providerTiming,
                            cost: costData || log.output.response.cost,
                          },
                        },
                      }
                    }
                    return log
                  }),
                  metadata: {
                    ...executionResult.metadata,
                    source: 'chat',
                    completedAt: new Date().toISOString(),
                    isStreamingComplete: true,
                    cost: costData || executionResult.metadata?.cost,
                    providerTiming: executionResult.output?.response?.providerTiming,
                  },
                  traceSpans: traceSpans,
                  totalDuration: totalDuration,
                },
              }),
            })

            if (!workflowExecutionApi.ok) {
              console.error('Failed to log complete streaming execution')
            }
          } catch (logError) {
            console.error('Error logging complete streaming execution:', logError)
          }
        }
      } catch (error) {
        console.error('Error processing stream:', error)

        // If there's an error and we haven't added a message yet, add an error message
        if (!hasAddedMessage) {
          addMessage({
            content: 'Error: Failed to process the streaming response.',
            workflowId: activeWorkflowId,
            type: 'workflow',
            id: messageId,
          } as any)
        } else {
          // Otherwise append the error to the existing message
          appendMessageContent(messageId, '\n\nError: Failed to process the streaming response.')
        }
      } finally {
        console.log('Finalizing stream')
        if (hasAddedMessage) {
          finalizeMessageStream(messageId)
        }
      }
    }
  }

  // Handle key press
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Handle output selection
  const handleOutputSelection = (values: string[]) => {
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
  }

  return (
    <div className="flex flex-col h-full">
      {/* Output Source Dropdown */}
      <div className="flex-none border-b px-4 py-2">
        <OutputSelect
          workflowId={activeWorkflowId}
          selectedOutputs={selectedOutputs}
          onOutputSelect={handleOutputSelection}
          disabled={!activeWorkflowId}
          placeholder="Select output sources"
        />
      </div>

      {/* Main layout with fixed heights to ensure input stays visible */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Chat messages section - Scrollable area */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div>
              {workflowMessages.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  No messages yet
                </div>
              ) : (
                workflowMessages.map((message) => (
                  <ChatMessage key={message.id} message={message} containerWidth={panelWidth} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Input section - Fixed height */}
        <div className="flex-none border-t bg-background pt-4 px-4 pb-4 relative -mt-[1px]">
          <div className="flex gap-2">
            <Input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 focus-visible:ring-0 focus-visible:ring-offset-0 h-10"
              disabled={!activeWorkflowId || isExecuting}
            />
            <Button
              onClick={handleSendMessage}
              size="icon"
              disabled={!chatMessage.trim() || !activeWorkflowId || isExecuting}
              className="h-10 w-10 bg-[#802FFF] hover:bg-[#7028E6] text-white"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
