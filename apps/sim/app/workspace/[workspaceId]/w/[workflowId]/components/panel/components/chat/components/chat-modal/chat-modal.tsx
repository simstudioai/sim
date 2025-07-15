'use client'

import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { JSONView } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/console/components/json-view/json-view'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import type { ChatMessage as ChatMessageType } from '@/stores/panel/chat/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
      <div className='px-4 py-5'>
        <div className='mx-auto max-w-3xl'>
          <div className='flex justify-end'>
            <div className='max-w-[80%] rounded-3xl bg-[#F4F4F4] px-4 py-3 shadow-sm dark:bg-primary/10'>
              <div className='whitespace-pre-wrap break-words text-[#0D0D0D] text-base leading-relaxed dark:text-white'>
                {isJsonObject ? (
                  <JSONView data={message.content} />
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
    <div className='px-4 py-5'>
      <div className='mx-auto max-w-3xl'>
        <div className='flex'>
          <div className='max-w-[80%]'>
            <div className='whitespace-pre-wrap break-words text-base leading-relaxed'>
              {isJsonObject ? <JSONView data={message.content} /> : <span>{message.content}</span>}
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
  const { messages, addMessage, getConversationId } = useChatStore()

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

    // Get the conversationId for this workflow before adding the message
    const conversationId = getConversationId(activeWorkflowId)

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
    await handleRunWorkflow({
      input: sentMessage,
      conversationId: conversationId,
    })

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
    <div className='fixed inset-0 z-[100] flex flex-col bg-background'>
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
      <div className='flex items-center justify-between px-4 py-3'>
        <h2 className='font-medium text-lg'>Chat</h2>
        <Button
          variant='ghost'
          size='icon'
          className='h-8 w-8 rounded-md hover:bg-accent/50'
          onClick={() => onOpenChange(false)}
        >
          <X className='h-4 w-4' />
          <span className='sr-only'>Close</span>
        </Button>
      </div>

      {/* Messages container */}
      <div ref={messagesContainerRef} className='flex-1 overflow-y-auto'>
        <div className='mx-auto max-w-3xl'>
          {workflowMessages.length === 0 ? (
            <div className='flex h-full flex-col items-center justify-center px-4 py-10'>
              <div className='space-y-2 text-center'>
                <h3 className='font-medium text-lg'>How can I help you today?</h3>
                <p className='text-muted-foreground text-sm'>
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
            <div className='px-4 py-5'>
              <div className='mx-auto max-w-3xl'>
                <div className='flex'>
                  <div className='max-w-[80%]'>
                    <div className='flex h-6 items-center'>
                      <div className='loading-dot h-3 w-3 rounded-full bg-black dark:bg-black' />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className='h-1' />
        </div>
      </div>

      {/* Input area (fixed at bottom) */}
      <div className='bg-background p-4'>
        <div className='mx-auto max-w-3xl'>
          <div className='relative rounded-2xl border bg-background shadow-sm'>
            <Input
              ref={inputRef}
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder='Message...'
              className='min-h-[50px] flex-1 rounded-2xl border-0 bg-transparent py-7 pr-16 pl-6 text-base focus-visible:ring-0 focus-visible:ring-offset-0'
              disabled={!activeWorkflowId}
            />
            <Button
              onClick={handleSendMessage}
              size='icon'
              disabled={!chatMessage.trim() || !activeWorkflowId || isExecuting}
              className='-translate-y-1/2 absolute top-1/2 right-3 h-10 w-10 rounded-xl bg-black p-0 text-white hover:bg-gray-800 dark:bg-primary dark:hover:bg-primary/80'
            >
              <ArrowUp className='h-4 w-4 dark:text-black' />
            </Button>
          </div>

          <div className='mt-2 text-center text-muted-foreground text-xs'>
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
