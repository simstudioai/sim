'use client'

import { type KeyboardEvent, useEffect, useRef } from 'react'
import {
  ArrowUp,
  Bot,
  ChevronDown,
  MessageSquarePlus,
  MoreHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { CopilotChat } from '@/lib/copilot-api'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('CopilotModal')

interface Message {
  id: string
  content: string
  type: 'user' | 'assistant'
  timestamp: Date
  citations?: Array<{
    id: number
    title: string
    url: string
  }>
}

interface CopilotModalMessage {
  message: Message
}

// Modal-specific message component
function ModalCopilotMessage({ message }: CopilotModalMessage) {
  const renderCitations = (
    text: string,
    citations?: Array<{ id: number; title: string; url: string }>
  ) => {
    if (!citations || citations.length === 0) return text

    let processedText = text

    // Replace [1], [2], [3] etc. with clickable citation icons
    processedText = processedText.replace(/\[(\d+)\]/g, (match, num) => {
      const citationIndex = Number.parseInt(num) - 1
      const citation = citations?.[citationIndex]

      if (citation) {
        return `<a href="${citation.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-primary hover:text-primary/80 text-sm" title="${citation.title}">↗</a>`
      }

      return match
    })

    // Also replace standalone ↗ symbols with clickable citation links
    if (citations && citations.length > 0) {
      let citationIndex = 0
      processedText = processedText.replace(/↗/g, () => {
        if (citationIndex < citations.length) {
          const citation = citations[citationIndex]
          citationIndex++
          return `<a href="${citation.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-primary hover:text-primary/80 text-sm" title="${citation.title}">↗</a>`
        }
        return '↗'
      })
    }

    return processedText
  }

  const renderMarkdown = (text: string) => {
    // Handle citations first
    let processedText = renderCitations(text, message.citations)

    // Handle code blocks
    processedText = processedText.replace(
      /```(\w+)?\n([\s\S]*?)\n```/g,
      '<pre class="bg-muted rounded-md p-3 my-2 overflow-x-auto"><code class="text-sm">$2</code></pre>'
    )

    // Handle inline code
    processedText = processedText.replace(
      /`([^`]+)`/g,
      '<code class="bg-muted px-1 rounded text-sm">$1</code>'
    )

    // Handle headers
    processedText = processedText.replace(
      /^### (.*$)/gm,
      '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>'
    )
    processedText = processedText.replace(
      /^## (.*$)/gm,
      '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>'
    )
    processedText = processedText.replace(
      /^# (.*$)/gm,
      '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>'
    )

    // Handle bold
    processedText = processedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

    // Handle lists
    processedText = processedText.replace(/^- (.*$)/gm, '<li class="ml-4">• $1</li>')

    // Handle line breaks (reduce spacing)
    processedText = processedText.replace(/\n\n+/g, '</p><p class="mt-2">')
    processedText = processedText.replace(/\n/g, '<br>')

    return processedText
  }

  // For user messages (on the right)
  if (message.type === 'user') {
    return (
      <div className='px-4 py-5'>
        <div className='mx-auto max-w-3xl'>
          <div className='flex justify-end'>
            <div className='max-w-[80%] rounded-3xl bg-[#F4F4F4] px-4 py-3 shadow-sm dark:bg-primary/10'>
              <div className='whitespace-pre-wrap break-words text-[#0D0D0D] text-base leading-relaxed dark:text-white'>
                {message.content}
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
            <div
              className='prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap break-words text-base leading-normal'
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

interface CopilotModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  copilotMessage: string
  setCopilotMessage: (message: string) => void
  messages: Message[]
  onSendMessage: (message: string) => Promise<void>
  isLoading: boolean
  // Chat management props
  chats: CopilotChat[]
  currentChat: CopilotChat | null
  onSelectChat: (chat: CopilotChat) => void
  onStartNewChat: () => void
  onDeleteChat: (chatId: string) => void
}

export function CopilotModal({
  open,
  onOpenChange,
  copilotMessage,
  setCopilotMessage,
  messages,
  onSendMessage,
  isLoading,
  chats,
  currentChat,
  onSelectChat,
  onStartNewChat,
  onDeleteChat,
}: CopilotModalProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Focus input when modal opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  // Handle send message
  const handleSendMessage = async () => {
    if (!copilotMessage.trim() || isLoading) return

    try {
      await onSendMessage(copilotMessage.trim())
      setCopilotMessage('')

      // Ensure input stays focused
      if (inputRef.current) {
        inputRef.current.focus()
      }
    } catch (error) {
      logger.error('Failed to send message', error)
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

      {/* Header with chat title, management, and close button */}
      <div className='flex items-center justify-between border-b px-4 py-3'>
        <div className='flex flex-1 items-center gap-2'>
          {/* Chat Title Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' className='h-8 max-w-[300px] flex-1 justify-start px-3'>
                <span className='truncate'>{currentChat?.title || 'New Chat'}</span>
                <ChevronDown className='ml-2 h-4 w-4 shrink-0' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='z-[110] w-64' sideOffset={8}>
              {chats.map((chat) => (
                <div key={chat.id} className='flex items-center'>
                  <DropdownMenuItem
                    onClick={() => onSelectChat(chat)}
                    className='flex-1 cursor-pointer'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-medium text-sm'>
                        {chat.title || 'Untitled Chat'}
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        {chat.messageCount} messages •{' '}
                        {new Date(chat.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='sm' className='h-8 w-8 shrink-0 p-0'>
                        <MoreHorizontal className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end' className='z-[120]'>
                      <DropdownMenuItem
                        onClick={() => onDeleteChat(chat.id)}
                        className='cursor-pointer text-destructive'
                      >
                        <Trash2 className='mr-2 h-4 w-4' />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* New Chat Button */}
          <Button
            variant='ghost'
            size='sm'
            onClick={onStartNewChat}
            className='h-8 w-8 p-0'
            title='New Chat'
          >
            <MessageSquarePlus className='h-4 w-4' />
          </Button>
        </div>

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
          {messages.length === 0 ? (
            <div className='flex h-full flex-col items-center justify-center px-4 py-10'>
              <div className='space-y-4 text-center'>
                <Bot className='mx-auto h-12 w-12 text-muted-foreground' />
                <div className='space-y-2'>
                  <h3 className='font-medium text-lg'>Welcome to Documentation Copilot</h3>
                  <p className='text-muted-foreground text-sm'>
                    Ask me anything about Sim Studio features, workflows, tools, or how to get
                    started.
                  </p>
                </div>
                <div className='mx-auto max-w-xs space-y-2 text-left'>
                  <div className='text-muted-foreground text-xs'>Try asking:</div>
                  <div className='space-y-1'>
                    <div className='rounded bg-muted/50 px-2 py-1 text-xs'>
                      "How do I create a workflow?"
                    </div>
                    <div className='rounded bg-muted/50 px-2 py-1 text-xs'>
                      "What tools are available?"
                    </div>
                    <div className='rounded bg-muted/50 px-2 py-1 text-xs'>
                      "How do I deploy my workflow?"
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            messages.map((message) => <ModalCopilotMessage key={message.id} message={message} />)
          )}

          {/* Loading indicator (shows only when loading) */}
          {isLoading && (
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
              value={copilotMessage}
              onChange={(e) => setCopilotMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder='Ask about Sim Studio documentation...'
              className='min-h-[50px] flex-1 rounded-2xl border-0 bg-transparent py-7 pr-16 pl-6 text-base focus-visible:ring-0 focus-visible:ring-offset-0'
              disabled={isLoading}
            />
            <Button
              onClick={handleSendMessage}
              size='icon'
              disabled={!copilotMessage.trim() || isLoading}
              className='-translate-y-1/2 absolute top-1/2 right-3 h-10 w-10 rounded-xl bg-black p-0 text-white hover:bg-gray-800 dark:bg-primary dark:hover:bg-primary/80'
            >
              <ArrowUp className='h-4 w-4 dark:text-black' />
            </Button>
          </div>

          <div className='mt-2 text-center text-muted-foreground text-xs'>
            <p>Ask questions about Sim Studio documentation and features</p>
          </div>
        </div>
      </div>
    </div>
  )
}
