'use client'

import { KeyboardEvent, useEffect, useMemo, useRef } from 'react'
import { ArrowUp, CornerDownLeft, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import { ChatMessage as ChatMessageType } from '@/stores/panel/chat/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { JSONView } from '@/app/w/[id]/components/panel/components/console/components/json-view/json-view'
import { useWorkflowExecution } from '@/app/w/[id]/hooks/use-workflow-execution'

interface ChatMessageProps {
  message: ChatMessageType
}

// ChatGPT-style message component specifically for modal
function ModalChatMessage({ message }: ChatMessageProps) {
  // Check if content is a JSON object
  const isJsonObject = useMemo(() => {
    return typeof message.content === 'object' && message.content !== null
  }, [message.content])

  // For user messages (on the right)
  if (message.type === 'user') {
    return (
      <div className="py-5 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-end">
            <div className="bg-[#F4F4F4] dark:bg-primary/10 rounded-3xl max-w-[80%] py-3 px-4 shadow-sm">
              <div className="whitespace-pre-wrap break-words text-base leading-relaxed text-[#0D0D0D] dark:text-white">
                {isJsonObject ? (
                  <JSONView data={message.content} initiallyExpanded={false} />
                ) : (
                  <span>{message.content}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // For assistant messages (on the left)
  return (
    <div className="py-5 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex">
          <div className="max-w-[80%]">
            <div className="whitespace-pre-wrap break-words text-base leading-relaxed">
              {isJsonObject ? (
                <JSONView data={message.content} initiallyExpanded={false} />
              ) : (
                <span>{message.content}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatMessage: string
  setChatMessage: (message: string) => void
}

export function ChatModal({ open, onOpenChange, chatMessage, setChatMessage }: ChatModalProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { activeWorkflowId } = useWorkflowRegistry()
  const { messages, addMessage } = useChatStore()

  // Use the execution store state to track if a workflow is executing
  const { isExecuting } = useExecutionStore()

  // Get workflow execution functionality
  const { handleRunWorkflow } = useWorkflowExecution()

  // Get filtered messages for current workflow
  const workflowMessages = useMemo(() => {
    if (!activeWorkflowId) return []
    return messages
      .filter((msg) => msg.workflowId === activeWorkflowId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [messages, activeWorkflowId])

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [workflowMessages])

  // Focus input when modal opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

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

    // Ensure input stays focused
    if (inputRef.current) {
      inputRef.current.focus()
    }

    // Execute the workflow to generate a response
    await handleRunWorkflow({ input: sentMessage })

    // Ensure input stays focused even after response
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  // Handle key press
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      <style jsx>{`
        @keyframes growShrink {
          0%,
          100% {
            transform: scale(0.9);
          }
          50% {
            transform: scale(1.1);
          }
        }
        .loading-dot {
          animation: growShrink 1.5s infinite ease-in-out;
        }
      `}</style>

      {/* Header with title and close button */}
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-medium">Chat</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-md hover:bg-accent/50"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      {/* Messages container */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {workflowMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-10 px-4">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-medium">How can I help you today?</h3>
                <p className="text-muted-foreground text-sm">
                  Ask me anything about your workflow.
                </p>
              </div>
            </div>
          ) : (
            workflowMessages.map((message) => (
              <ModalChatMessage key={message.id} message={message} />
            ))
          )}

          {/* Loading indicator (shows only when executing) */}
          {isExecuting && (
            <div className="py-5 px-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex">
                  <div className="max-w-[80%]">
                    <div className="flex items-center h-6">
                      <div className="w-3 h-3 rounded-full bg-black dark:bg-black loading-dot"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className="h-1" />
        </div>
      </div>

      {/* Input area (fixed at bottom) */}
      <div className="bg-background p-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-2xl border bg-background shadow-sm">
            <Input
              ref={inputRef}
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Message..."
              className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 py-7 pr-16 bg-transparent pl-6 text-base min-h-[50px] rounded-2xl"
              disabled={!activeWorkflowId}
            />
            <Button
              onClick={handleSendMessage}
              size="icon"
              disabled={!chatMessage.trim() || !activeWorkflowId || isExecuting}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 p-0 rounded-xl bg-black dark:bg-primary text-white hover:bg-gray-800 dark:hover:bg-primary/80"
            >
              <ArrowUp className="h-4 w-4 dark:text-black" />
            </Button>
          </div>

          <div className="mt-2 text-center text-xs text-muted-foreground">
            <p>
              {activeWorkflowId
                ? 'Your messages will be processed by the active workflow'
                : 'Select a workflow to start chatting'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
