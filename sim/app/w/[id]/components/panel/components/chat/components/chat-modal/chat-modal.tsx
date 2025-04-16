'use client'

import { KeyboardEvent, useEffect, useMemo, useRef } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowExecution } from '@/app/w/[id]/hooks/use-workflow-execution'

interface ChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatMessage: string
  setChatMessage: (message: string) => void
}

export function ChatModal({ open, onOpenChange, chatMessage, setChatMessage }: ChatModalProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

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

    // Execute the workflow to generate a response
    await handleRunWorkflow({ input: sentMessage })
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
      {/* Close button (fixed position) */}
      <div className="absolute top-4 left-4 z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 p-0 bg-background/80 hover:bg-accent/50 backdrop-blur-sm"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      {/* Messages container */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto pb-32">
        <div>
          {workflowMessages.map((message) => (
            <div key={message.id} className={cn('py-6 px-4', message.type === 'user' ? '' : '')}>
              <div
                className={cn(
                  'max-w-3xl mx-auto',
                  message.type === 'user' ? 'flex justify-end' : ''
                )}
              >
                <div
                  className={cn(
                    'whitespace-pre-wrap break-words leading-relaxed max-w-[80%]',
                    message.type === 'user'
                      ? 'bg-[#802FFF] dark:bg-[#7028E6] text-white py-3 px-4 rounded-2xl'
                      : 'text-base'
                  )}
                >
                  {message.content}
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator (shows only when executing) */}
          {isExecuting && (
            <div className="py-6 px-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center h-8">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className="h-1" />
        </div>
      </div>

      {/* Input area (fixed at bottom) */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-background to-background/80 pb-6">
        <div className="max-w-3xl mx-auto">
          <div className="relative rounded-xl border bg-background shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] transition-shadow">
            <Input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Message..."
              className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-14 pr-12 bg-transparent pl-4 text-base"
              disabled={!activeWorkflowId || isExecuting}
            />
            <Button
              onClick={handleSendMessage}
              size="icon"
              disabled={!chatMessage.trim() || !activeWorkflowId || isExecuting}
              className="absolute right-2 top-2 h-10 w-10 bg-[#802FFF] hover:bg-[#7028E6] text-white rounded-lg"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Typing indicator animation styles */}
      <style jsx global>{`
        .typing-indicator {
          display: flex;
          align-items: center;
        }

        .typing-indicator span {
          height: 8px;
          width: 8px;
          margin: 0 2px;
          background-color: #888;
          border-radius: 50%;
          display: inline-block;
          opacity: 0.7;
        }

        .typing-indicator span:nth-child(1) {
          animation: bounce 1s infinite 0.1s;
        }

        .typing-indicator span:nth-child(2) {
          animation: bounce 1s infinite 0.3s;
        }

        .typing-indicator span:nth-child(3) {
          animation: bounce 1s infinite 0.5s;
        }

        @keyframes bounce {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
      `}</style>
    </div>
  )
}
