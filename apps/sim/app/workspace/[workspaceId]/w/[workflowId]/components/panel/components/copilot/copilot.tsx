'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import {
  Bot,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Send,
  Trash2,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console-logger'
import { useCopilotStore } from '@/stores/copilot/store'
import type { CopilotMessage } from '@/stores/copilot/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { CopilotModal } from './components/copilot-modal/copilot-modal'

const logger = createLogger('Copilot')

interface CopilotProps {
  panelWidth: number
  isFullscreen?: boolean
  onFullscreenToggle?: (fullscreen: boolean) => void
  fullscreenInput?: string
  onFullscreenInputChange?: (input: string) => void
}

interface CopilotRef {
  clearMessages: () => void
  startNewChat: () => void
}

export const Copilot = forwardRef<CopilotRef, CopilotProps>(
  (
    {
      panelWidth,
      isFullscreen = false,
      onFullscreenToggle,
      fullscreenInput = '',
      onFullscreenInputChange,
    },
    ref
  ) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const scrollAreaRef = useRef<HTMLDivElement>(null)

    const { activeWorkflowId } = useWorkflowRegistry()

    // Use the new copilot store
    const {
      currentChat,
      chats,
      messages,
      isLoading,
      isLoadingChats,
      isSendingMessage,
      error,
      workflowId,
      setWorkflowId,
      selectChat,
      createNewChat,
      deleteChat,
      sendMessage,
      clearMessages,
      clearError,
    } = useCopilotStore()

    // Sync workflow ID with store
    useEffect(() => {
      if (activeWorkflowId !== workflowId) {
        setWorkflowId(activeWorkflowId)
      }
    }, [activeWorkflowId, workflowId, setWorkflowId])

    // Auto-scroll to bottom when new messages are added
    useEffect(() => {
      if (scrollAreaRef.current) {
        const scrollContainer = scrollAreaRef.current.querySelector(
          '[data-radix-scroll-area-viewport]'
        )
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight
        }
      }
    }, [messages])

    // Handle chat deletion
    const handleDeleteChat = useCallback(
      async (chatId: string) => {
        try {
          await deleteChat(chatId)
          logger.info('Chat deleted successfully')
        } catch (error) {
          logger.error('Error deleting chat:', error)
        }
      },
      [deleteChat]
    )

    // Handle new chat creation
    const handleStartNewChat = useCallback(() => {
      clearMessages()
      logger.info('Started new chat')
    }, [clearMessages])

    // Expose functions to parent
    useImperativeHandle(
      ref,
      () => ({
        clearMessages: handleStartNewChat,
        startNewChat: handleStartNewChat,
      }),
      [handleStartNewChat]
    )

    // Handle message submission
    const handleSubmit = useCallback(
      async (e: React.FormEvent, message?: string) => {
        e.preventDefault()

        const query = message || inputRef.current?.value?.trim() || ''
        if (!query || isSendingMessage || !activeWorkflowId) return

        // Clear input if using the form input
        if (!message && inputRef.current) {
          inputRef.current.value = ''
        }

        try {
          await sendMessage(query, { stream: true })
          logger.info('Sent message:', query)
        } catch (error) {
          logger.error('Failed to send message:', error)
        }
      },
      [isSendingMessage, activeWorkflowId, sendMessage]
    )

    // Format timestamp for display
    const formatTimestamp = (timestamp: string) => {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    // Function to render content with inline hyperlinked citations and basic markdown
    const renderContentWithCitations = (
      content: string,
      citations: CopilotMessage['citations'] = []
    ) => {
      if (!content) return content

      let processedContent = content

      // Replace [1], [2], [3] etc. with clickable citation icons
      processedContent = processedContent.replace(/\[(\d+)\]/g, (match, num) => {
        const citationIndex = Number.parseInt(num) - 1
        const citation = citations?.[citationIndex]

        if (citation) {
          return `<a href="${citation.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center ml-1 text-primary hover:text-primary/80 transition-colors text-sm" title="${citation.title}">↗</a>`
        }

        return match
      })

      // Also replace standalone ↗ symbols with clickable citation links
      if (citations && citations.length > 0) {
        let citationIndex = 0
        processedContent = processedContent.replace(/↗/g, () => {
          if (citationIndex < citations.length) {
            const citation = citations[citationIndex]
            citationIndex++
            return `<a href="${citation.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-primary hover:text-primary/80 transition-colors text-sm" title="${citation.title}">↗</a>`
          }
          return '↗'
        })
      }

      // Basic markdown processing
      processedContent = processedContent
        .replace(
          /```(\w+)?\n([\s\S]*?)```/g,
          '<pre class="bg-muted p-3 rounded-lg overflow-x-auto my-3 text-sm"><code>$2</code></pre>'
        )
        .replace(
          /`([^`]+)`/g,
          '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>'
        )
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
        .replace(/^### (.*$)/gm, '<h3 class="font-semibold text-base mt-4 mb-2">$1</h3>')
        .replace(/^## (.*$)/gm, '<h2 class="font-semibold text-lg mt-4 mb-2">$1</h2>')
        .replace(/^# (.*$)/gm, '<h1 class="font-bold text-xl mt-4 mb-3">$1</h1>')
        .replace(/^\* (.*$)/gm, '<li class="ml-4">• $1</li>')
        .replace(/^- (.*$)/gm, '<li class="ml-4">• $1</li>')
        .replace(/\n\n+/g, '</p><p class="mt-2">')
        .replace(/\n/g, '<br>')

      // Wrap in paragraph tags if needed
      if (
        !processedContent.includes('<p>') &&
        !processedContent.includes('<h1>') &&
        !processedContent.includes('<h2>') &&
        !processedContent.includes('<h3>')
      ) {
        processedContent = `<p>${processedContent}</p>`
      }

      return processedContent
    }

    // Render individual message
    const renderMessage = (message: CopilotMessage) => {
      return (
        <div key={message.id} className='group flex gap-3 p-4 hover:bg-muted/30'>
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full ${
              message.role === 'user' ? 'bg-muted' : 'bg-primary'
            }`}
          >
            {message.role === 'user' ? (
              <User className='h-4 w-4 text-muted-foreground' />
            ) : (
              <Bot className='h-4 w-4 text-primary-foreground' />
            )}
          </div>
          <div className='min-w-0 flex-1'>
            <div className='mb-3 flex items-center gap-2'>
              <span className='font-medium text-sm'>
                {message.role === 'user' ? 'You' : 'Copilot'}
              </span>
              <span className='text-muted-foreground text-xs'>
                {formatTimestamp(message.timestamp)}
              </span>
            </div>

            {/* Enhanced content rendering with inline citations */}
            <div className='prose prose-sm dark:prose-invert max-w-none'>
              <div
                className='text-foreground text-sm leading-normal'
                dangerouslySetInnerHTML={{
                  __html: renderContentWithCitations(message.content, message.citations),
                }}
              />
            </div>

            {/* Streaming cursor */}
            {!message.content && (
              <div className='flex items-center gap-2 text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' />
                <span className='text-sm'>Thinking...</span>
              </div>
            )}
          </div>
        </div>
      )
    }

    // Convert messages for modal (role -> type)
    const modalMessages = messages.map((msg) => ({
      id: msg.id,
      content: msg.content,
      type: msg.role as 'user' | 'assistant',
      timestamp: new Date(msg.timestamp),
      citations: msg.citations,
    }))

    // Handle modal message sending
    const handleModalSendMessage = useCallback(
      async (message: string) => {
        const mockEvent = { preventDefault: () => {} } as React.FormEvent
        await handleSubmit(mockEvent, message)
      },
      [handleSubmit]
    )

    return (
      <>
        <div className='flex h-full flex-col'>
          {/* Header with Chat Title and Management */}
          <div className='border-b p-4'>
            <div className='flex items-center justify-between'>
              {/* Chat Title Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' className='h-8 min-w-0 flex-1 justify-start px-3'>
                    <span className='truncate'>{currentChat?.title || 'New Chat'}</span>
                    <ChevronDown className='ml-2 h-4 w-4 shrink-0' />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='z-[110] w-64' sideOffset={8}>
                  {chats.map((chat) => (
                    <div key={chat.id} className='flex items-center'>
                      <DropdownMenuItem
                        onClick={() => selectChat(chat)}
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
                            onClick={() => handleDeleteChat(chat.id)}
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
                onClick={handleStartNewChat}
                className='h-8 w-8 p-0'
                title='New Chat'
              >
                <MessageSquarePlus className='h-4 w-4' />
              </Button>
            </div>

            {/* Error display */}
            {error && (
              <div className='mt-2 rounded-md bg-destructive/10 p-2 text-destructive text-sm'>
                {error}
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={clearError}
                  className='ml-2 h-auto p-1 text-destructive'
                >
                  Dismiss
                </Button>
              </div>
            )}
          </div>

          {/* Messages area */}
          <ScrollArea ref={scrollAreaRef} className='flex-1'>
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
              messages.map(renderMessage)
            )}
          </ScrollArea>

          {/* Input area */}
          <div className='border-t p-4'>
            <form onSubmit={handleSubmit} className='flex gap-2'>
              <Input
                ref={inputRef}
                placeholder='Ask about Sim Studio documentation...'
                disabled={isSendingMessage}
                className='flex-1'
                autoComplete='off'
              />
              <Button type='submit' size='icon' disabled={isSendingMessage} className='h-10 w-10'>
                {isSendingMessage ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Send className='h-4 w-4' />
                )}
              </Button>
            </form>
          </div>
        </div>

        {/* Fullscreen Modal */}
        <CopilotModal
          open={isFullscreen}
          onOpenChange={(open) => onFullscreenToggle?.(open)}
          copilotMessage={fullscreenInput}
          setCopilotMessage={(message) => onFullscreenInputChange?.(message)}
          messages={modalMessages}
          onSendMessage={handleModalSendMessage}
          isLoading={isSendingMessage}
          chats={chats}
          currentChat={currentChat}
          onSelectChat={selectChat}
          onStartNewChat={handleStartNewChat}
          onDeleteChat={handleDeleteChat}
        />
      </>
    )
  }
)

Copilot.displayName = 'Copilot'
