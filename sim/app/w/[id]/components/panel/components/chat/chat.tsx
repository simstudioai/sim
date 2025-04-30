'use client'

import { KeyboardEvent, useEffect, useMemo, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
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
  const { messages, addMessage, selectedWorkflowOutputs, setSelectedWorkflowOutput } =
    useChatStore()
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
    // The workflow execution will trigger block executions which will add messages to the chat via the console store
    await handleRunWorkflow({ input: sentMessage })
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
