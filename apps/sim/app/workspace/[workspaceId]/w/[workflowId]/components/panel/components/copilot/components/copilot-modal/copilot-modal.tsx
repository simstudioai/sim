'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, History, MessageSquarePlus, MoreHorizontal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CopilotChat } from '@/lib/copilot/api'
import { createLogger } from '@/lib/logs/console-logger'
import type { CopilotMessage } from '@/stores/copilot/types'
import { CheckpointPanel } from '../checkpoint-panel'
import { ProfessionalInput } from '../professional-input/professional-input'
import { ProfessionalMessage } from '../professional-message/professional-message'
import { CopilotWelcome } from '../welcome/welcome'

const logger = createLogger('CopilotModal')

interface CopilotModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  copilotMessage: string
  setCopilotMessage: (message: string) => void
  messages: CopilotMessage[]
  onSendMessage: (message: string) => Promise<void>
  onAbortMessage?: () => void
  isLoading: boolean
  isAborting?: boolean
  isLoadingChats: boolean
  // Chat management props
  chats: CopilotChat[]
  currentChat: CopilotChat | null
  onSelectChat: (chat: CopilotChat) => void
  onStartNewChat: () => void
  onDeleteChat: (chatId: string) => void
  // Mode props
  mode: 'ask' | 'agent'
  onModeChange: (mode: 'ask' | 'agent') => void
}

export function CopilotModal({
  open,
  onOpenChange,
  copilotMessage,
  setCopilotMessage,
  messages,
  onSendMessage,
  onAbortMessage,
  isLoading,
  isAborting,
  isLoadingChats,
  chats,
  currentChat,
  onSelectChat,
  onStartNewChat,
  onDeleteChat,
  mode,
  onModeChange,
}: CopilotModalProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [showCheckpoints, setShowCheckpoints] = useState(false)

  // Fixed sidebar width for copilot modal positioning
  const sidebarWidth = 240 // w-60 (sidebar width from staging)

  // Auto-scroll to bottom when new messages are added with smooth behavior
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'nearest',
      })
    }
  }, [messages])

  // Auto-scroll when messages update during streaming
  useEffect(() => {
    if (isLoading && messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 100

      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        })
      }
    }
  }, [messages, isLoading])

  if (!open) return null

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm'
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onOpenChange(false)
        }
      }}
    >
      <div
        className='flex h-[90vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl transition-all duration-300'
        style={{
          marginLeft: `${sidebarWidth / 2}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className='flex items-center justify-between border-b bg-muted/30 p-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg'>
              <Bot className='h-5 w-5' />
            </div>
            <div>
              <h2 className='font-semibold text-foreground text-lg'>Copilot Assistant</h2>
              <p className='text-muted-foreground text-sm'>
                {mode === 'ask'
                  ? 'Ask questions about your workflow'
                  : 'Agent mode - Let me help you build'}
              </p>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            {/* Chat History Dropdown */}
            <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-9 w-9 p-0 hover:bg-accent/50'
                  title='Chat History'
                >
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-80'>
                <div className='max-h-80 overflow-y-auto'>
                  {isLoadingChats ? (
                    <div className='flex items-center justify-center p-4'>
                      <div className='h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent' />
                      <span className='ml-2 text-muted-foreground text-sm'>Loading chats...</span>
                    </div>
                  ) : chats.length === 0 ? (
                    <div className='p-4 text-center text-muted-foreground text-sm'>
                      No chat history yet
                    </div>
                  ) : (
                    chats.map((chat) => (
                      <DropdownMenuItem
                        key={chat.id}
                        className='flex cursor-pointer items-center justify-between p-3'
                        onClick={() => {
                          onSelectChat(chat)
                          setIsDropdownOpen(false)
                        }}
                      >
                        <div className='min-w-0 flex-1'>
                          <div className='truncate font-medium text-sm'>
                            {chat.title || 'Untitled Chat'}
                          </div>
                          <div className='text-muted-foreground text-xs'>
                            {chat.messageCount} messages
                          </div>
                        </div>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='ml-2 h-6 w-6 p-0 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100'
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteChat(chat.id)
                          }}
                          title='Delete Chat'
                        >
                          <Trash2 className='h-3 w-3' />
                        </Button>
                      </DropdownMenuItem>
                    ))
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className='h-6 w-px bg-border' />

            {/* Action buttons */}
            <div className='flex items-center gap-2'>
              {/* Checkpoint Toggle Button */}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setShowCheckpoints(!showCheckpoints)}
                className={`h-9 w-9 p-0 transition-colors ${
                  showCheckpoints
                    ? 'bg-[#802FFF]/20 text-[#802FFF] hover:bg-[#802FFF]/30'
                    : 'hover:bg-accent/50'
                }`}
                title='View Checkpoints'
              >
                <History className='h-4 w-4' />
              </Button>

              {/* New Chat Button */}
              <Button
                variant='ghost'
                size='sm'
                onClick={onStartNewChat}
                className='h-9 w-9 p-0 hover:bg-accent/50'
                title='New Chat'
              >
                <MessageSquarePlus className='h-4 w-4' />
              </Button>

              {/* Close Button */}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                className='h-9 w-9 p-0 hover:bg-accent/50'
                title='Close'
              >
                <X className='h-4 w-4' />
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className='flex flex-1 flex-col overflow-hidden'>
          {showCheckpoints ? (
            <div className='flex-1 overflow-hidden p-4'>
              <CheckpointPanel />
            </div>
          ) : (
            <>
              {/* Messages Area */}
              <ScrollArea
                ref={messagesContainerRef}
                className='flex-1 px-4 py-2'
                style={{ height: 'calc(100% - 120px)' }}
              >
                <div className='mx-auto max-w-3xl'>
                  {messages.length === 0 ? (
                    <div className='flex h-full items-center justify-center'>
                      <CopilotWelcome onQuestionClick={onSendMessage} mode={mode} />
                    </div>
                  ) : (
                    <div className='space-y-1'>
                      {messages.map((message) => (
                        <ProfessionalMessage
                          key={message.id}
                          message={message}
                          isStreaming={
                            isLoading && message.id === messages[messages.length - 1]?.id
                          }
                        />
                      ))}
                    </div>
                  )}
                  <div ref={messagesEndRef} className='h-4' />
                </div>
              </ScrollArea>

              {/* Input Area */}
              <div className='border-t bg-muted/20 p-4'>
                <div className='mx-auto max-w-3xl space-y-3'>
                  {/* Mode Selector */}
                  <div className='flex items-center gap-1 rounded-lg border bg-muted/30 p-0.5'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => onModeChange('ask')}
                      className={`h-7 flex-1 font-medium text-xs transition-colors ${
                        mode === 'ask'
                          ? 'bg-[#802FFF]/20 text-[#802FFF] hover:bg-[#802FFF]/30'
                          : 'hover:bg-muted/50'
                      }`}
                      title='Ask questions and get answers. Cannot edit workflows.'
                    >
                      Ask
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => onModeChange('agent')}
                      className={`h-7 flex-1 font-medium text-xs transition-colors ${
                        mode === 'agent'
                          ? 'bg-[#802FFF]/20 text-[#802FFF] hover:bg-[#802FFF]/30'
                          : 'hover:bg-muted/50'
                      }`}
                      title='Full agent with workflow editing capabilities.'
                    >
                      Agent
                    </Button>
                  </div>

                  {/* Input */}
                  <ProfessionalInput
                    onSubmit={async (message) => {
                      await onSendMessage(message)
                      setCopilotMessage('')
                    }}
                    onAbort={onAbortMessage}
                    disabled={false}
                    isLoading={isLoading}
                    isAborting={isAborting}
                    placeholder={
                      mode === 'ask'
                        ? 'Ask me anything about your workflow...'
                        : 'Describe what you want to build...'
                    }
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
