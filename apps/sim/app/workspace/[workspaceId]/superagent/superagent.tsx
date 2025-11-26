'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Plus, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/emcn'
import { ScrollArea } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { useSuperagentStore } from '@/stores/superagent/store'
import { cn } from '@/lib/utils'

const logger = createLogger('Superagent')

/**
 * Superagent page component - Standalone AI agent with full tool access
 * Uses an agent with all available integration tools
 */
export default function Superagent() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [inputValue, setInputValue] = useState('')

  const {
    messages,
    isSendingMessage,
    error,
    workspaceId: storeWorkspaceId,
    chats,
    currentChatId,
    isLoadingChats,
    setWorkspaceId,
    sendMessage,
    abortMessage,
    clearMessages,
    loadChats,
    selectChat,
    createNewChat,
  } = useSuperagentStore()

  // Initialize workspace ID and load chats
  useEffect(() => {
    if (workspaceId && workspaceId !== storeWorkspaceId) {
      setWorkspaceId(workspaceId)
      loadChats()
    }
  }, [workspaceId, storeWorkspaceId, setWorkspaceId, loadChats])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages])

  const handleSubmit = async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isSendingMessage) return

    setInputValue('')
    await sendMessage(trimmed)
    
    // Focus back on textarea
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleAbort = () => {
    abortMessage()
  }

  const handleClear = () => {
    if (confirm('Clear all messages?')) {
      clearMessages()
    }
  }

  return (
    <div className='fixed inset-0 left-[256px] flex min-w-0 flex-col bg-background'>
      <div className='flex flex-1 overflow-hidden'>
        {/* Chat History Sidebar */}
        <div className='w-[280px] flex-shrink-0 border-r'>
          <div className='flex h-[60px] items-center justify-between border-b px-[16px]'>
            <h2 className='font-medium text-sm'>Chat History</h2>
            <Button variant='ghost' onClick={createNewChat} disabled={isSendingMessage} className='h-8 w-8 p-0'>
              <Plus className='h-4 w-4' />
            </Button>
          </div>
          <ScrollArea className='h-[calc(100vh-60px)]'>
            <div className='p-[8px]'>
              {isLoadingChats ? (
                <div className='flex items-center justify-center p-[24px]'>
                  <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                </div>
              ) : chats.length === 0 ? (
                <div className='p-[16px] text-center text-muted-foreground text-xs'>
                  No chats yet
                </div>
              ) : (
                chats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => selectChat(chat.id)}
                    className={cn(
                      'mb-[4px] w-full rounded-[8px] p-[12px] text-left transition-colors',
                      currentChatId === chat.id
                        ? 'bg-muted'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className='truncate font-medium text-sm'>
                      {chat.title || 'Untitled Chat'}
                    </div>
                    <div className='truncate text-muted-foreground text-xs'>
                      {chat.messages.length} messages
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Main Chat Area */}
        <div className='flex flex-1 flex-col'>
          {/* Header */}
          <div className='flex h-[60px] flex-shrink-0 items-center justify-between border-b px-[24px]'>
            <div>
              <h1 className='font-semibold text-lg'>Superagent</h1>
            </div>
            {messages.length > 0 && (
              <Button
                variant='ghost'
                onClick={handleClear}
                disabled={isSendingMessage}
                className='gap-2'
              >
                <Trash2 className='h-4 w-4' />
                Clear
              </Button>
            )}
          </div>

          {/* Messages area */}
          <ScrollArea ref={scrollAreaRef} className='flex-1'>
            <div className='mx-auto max-w-[800px] p-[24px]'>
              {messages.length === 0 ? (
                <div className='flex h-full flex-col items-center justify-center gap-4 text-center'>
                  <div className='text-muted-foreground text-sm'>
                    <p className='mb-2 font-medium'>Welcome to Superagent</p>
                    <p>This AI agent has access to 600+ integration tools including GitHub, Google Drive, Slack, and more.</p>
                    <p className='mt-4 text-xs'>Start a conversation by typing a message below.</p>
                  </div>
                </div>
              ) : (
                <div className='flex flex-col gap-6'>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex flex-col gap-2',
                        msg.role === 'user' ? 'items-end' : 'items-start'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] rounded-[12px] px-[16px] py-[12px]',
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        )}
                      >
                        <div className='whitespace-pre-wrap text-sm'>{msg.content}</div>
                        
                        {/* Show tool calls */}
                        {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className='mt-3 space-y-1 border-t pt-2'>
                            {msg.toolCalls.map((tool, idx) => (
                              <div key={idx} className='flex items-center gap-2 text-xs'>
                                {tool.status === 'calling' && <Loader2 className='h-3 w-3 animate-spin' />}
                                {tool.status === 'success' && <span className='text-green-600'>✓</span>}
                                {tool.status === 'error' && <span className='text-red-600'>✗</span>}
                                <span className='font-mono'>{tool.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {msg.role === 'assistant' && !msg.content && isSendingMessage && (
                        <div className='flex items-center gap-2 text-muted-foreground text-xs'>
                          <Loader2 className='h-3 w-3 animate-spin' />
                          <span>Thinking...</span>
                        </div>
                      )}
                    </div>
                  ))}
                  {error && (
                    <div className='rounded-[12px] border border-destructive bg-destructive/10 p-[16px] text-destructive text-sm'>
                      Error: {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input area */}
          <div className='flex-shrink-0 border-t bg-background p-[24px]'>
        <div className='mx-auto max-w-[800px]'>
          <div className='relative flex items-end gap-2'>
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Type your message... (Shift+Enter for new line)'
              disabled={isSendingMessage}
              className='min-h-[60px] max-h-[200px] flex-1 resize-none rounded-[12px] border bg-background px-[16px] py-[12px] text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50'
              rows={1}
              style={{
                height: 'auto',
                minHeight: '60px',
              }}
            />
            {isSendingMessage ? (
              <Button
                onClick={handleAbort}
                variant='ghost'
                className='h-[60px] w-[60px] flex-shrink-0'
              >
                <X className='h-5 w-5' />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={!inputValue.trim() || isSendingMessage}
                className='h-[60px] w-[60px] flex-shrink-0'
              >
                <Send className='h-5 w-5' />
              </Button>
            )}
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>
  )
}
