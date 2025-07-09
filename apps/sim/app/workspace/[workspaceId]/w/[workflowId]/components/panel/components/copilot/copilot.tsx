'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
import {
  type CopilotChat,
  type CopilotMessage,
  deleteChat,
  getChat,
  listChats,
  sendStreamingMessage,
} from '@/lib/copilot-api'
import { createLogger } from '@/lib/logs/console-logger'
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
    const [messages, setMessages] = useState<CopilotMessage[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [currentChat, setCurrentChat] = useState<CopilotChat | null>(null)
    const [chats, setChats] = useState<CopilotChat[]>([])
    const [loadingChats, setLoadingChats] = useState(false)
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const { activeWorkflowId } = useWorkflowRegistry()

    // Load chats when workflow changes
    useEffect(() => {
      if (activeWorkflowId) {
        loadChats()
      }
    }, [activeWorkflowId])

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

    // Load chats for current workflow
    const loadChats = useCallback(async () => {
      if (!activeWorkflowId) return

      setLoadingChats(true)
      try {
        const result = await listChats(activeWorkflowId)
        if (result.success) {
          setChats(result.chats)
          // If no current chat and we have chats, select the most recent one
          if (!currentChat && result.chats.length > 0) {
            await selectChat(result.chats[0])
          }
        } else {
          logger.error('Failed to load chats:', result.error)
        }
      } catch (error) {
        logger.error('Error loading chats:', error)
      } finally {
        setLoadingChats(false)
      }
    }, [activeWorkflowId, currentChat])

    // Select a specific chat and load its messages
    const selectChat = useCallback(async (chat: CopilotChat) => {
      try {
        const result = await getChat(chat.id)
        if (result.success && result.chat) {
          setCurrentChat(result.chat)
          setMessages(result.chat.messages || [])
          logger.info(`Loaded chat: ${chat.title || 'Untitled'}`)
        } else {
          logger.error('Failed to load chat:', result.error)
        }
      } catch (error) {
        logger.error('Error loading chat:', error)
      }
    }, [])

    // Start a new chat
    const startNewChat = useCallback(() => {
      setCurrentChat(null)
      setMessages([])
      logger.info('Started new chat')
    }, [])

    // Delete a chat
    const handleDeleteChat = useCallback(
      async (chatId: string) => {
        try {
          const result = await deleteChat(chatId)
          if (result.success) {
            setChats((prev) => prev.filter((chat) => chat.id !== chatId))
            if (currentChat?.id === chatId) {
              startNewChat()
            }
            logger.info('Chat deleted successfully')
          } else {
            logger.error('Failed to delete chat:', result.error)
          }
        } catch (error) {
          logger.error('Error deleting chat:', error)
        }
      },
      [currentChat, startNewChat]
    )

    // Expose functions to parent
    useImperativeHandle(
      ref,
      () => ({
        clearMessages: startNewChat,
        startNewChat,
      }),
      [startNewChat]
    )

    // Handle message submission
    const handleSubmit = useCallback(
      async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || isLoading || !activeWorkflowId) return

        const query = input.trim()
        setInput('')
        setIsLoading(true)

        // Add user message immediately
        const userMessage: CopilotMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: query,
          timestamp: new Date().toISOString(),
        }

        // Add streaming placeholder
        const streamingMessage: CopilotMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
        }

        setMessages((prev) => [...prev, userMessage, streamingMessage])

        try {
          logger.info('Sending docs RAG query:', { query, chatId: currentChat?.id })

          const result = await sendStreamingMessage({
            query,
            topK: 5,
            chatId: currentChat?.id,
            workflowId: activeWorkflowId,
            createNewChat: !currentChat,
          })

          if (result.success && result.stream) {
            const reader = result.stream.getReader()
            const decoder = new TextDecoder()
            let accumulatedContent = ''
            let sources: any[] = []
            let newChatId: string | undefined

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              const lines = chunk.split('\n')

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6))

                    if (data.type === 'metadata') {
                      sources = data.sources || []
                      // Get chatId from metadata (for both new and existing chats)
                      if (data.chatId) {
                        newChatId = data.chatId
                      }
                    } else if (data.type === 'content') {
                      accumulatedContent += data.content

                      // Update the streaming message with accumulated content
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === streamingMessage.id
                            ? {
                                ...msg,
                                content: accumulatedContent,
                                citations: sources.map((source: any, index: number) => ({
                                  id: index + 1,
                                  title: source.title,
                                  url: source.link,
                                })),
                              }
                            : msg
                        )
                      )
                    } else if (data.type === 'done') {
                      // Finish streaming and reload chat if new chat was created
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === streamingMessage.id
                            ? {
                                ...msg,
                                citations: sources.map((source: any, index: number) => ({
                                  id: index + 1,
                                  title: source.title,
                                  url: source.link,
                                })),
                              }
                            : msg
                        )
                      )

                      // Update current chat state with the chatId from response
                      if (newChatId && !currentChat) {
                        // For new chats, create a temporary chat object and reload the full chat list
                        setCurrentChat({
                          id: newChatId,
                          title: null,
                          model: 'claude-3-7-sonnet-latest',
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                          messageCount: 2, // User + assistant message
                        })
                        // Reload chats in background to get the updated list
                        loadChats()
                      }
                    } else if (data.type === 'error') {
                      throw new Error(data.error || 'Streaming error')
                    }
                  } catch (parseError) {
                    logger.warn('Failed to parse SSE data:', parseError)
                  }
                }
              }
            }

            logger.info('Received docs RAG response:', {
              contentLength: accumulatedContent.length,
              sourcesCount: sources.length,
            })
          } else {
            throw new Error(result.error || 'Failed to send message')
          }
        } catch (error) {
          logger.error('Docs RAG error:', error)

          const errorMessage: CopilotMessage = {
            id: streamingMessage.id,
            role: 'assistant',
            content:
              'Sorry, I encountered an error while searching the documentation. Please try again.',
            timestamp: new Date().toISOString(),
          }

          setMessages((prev) => prev.slice(0, -1).concat(errorMessage))
        } finally {
          setIsLoading(false)
        }
      },
      [input, isLoading, activeWorkflowId, currentChat, loadChats]
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

      // Replace {cite:1}, {cite:2}, etc. with clickable citation icons
      processedContent = processedContent.replace(/\{cite:(\d+)\}/g, (match, num) => {
        const citationIndex = Number.parseInt(num) - 1
        const citation = citations?.[citationIndex]

        if (citation) {
          return `<a href="${citation.url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center ml-1 text-primary hover:text-primary/80 transition-colors text-sm" title="${citation.title}">↗</a>`
        }

        return match
      })

      // Basic markdown processing for better formatting
      processedContent = processedContent
        // Handle code blocks
        .replace(
          /```(\w+)?\n([\s\S]*?)```/g,
          '<pre class="bg-muted p-3 rounded-lg overflow-x-auto my-3 text-sm"><code>$2</code></pre>'
        )
        // Handle inline code
        .replace(
          /`([^`]+)`/g,
          '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>'
        )
        // Handle bold text
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
        // Handle italic text
        .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
        // Handle headers
        .replace(/^### (.*$)/gm, '<h3 class="font-semibold text-base mt-4 mb-2">$1</h3>')
        .replace(/^## (.*$)/gm, '<h2 class="font-semibold text-lg mt-4 mb-2">$1</h2>')
        .replace(/^# (.*$)/gm, '<h1 class="font-bold text-xl mt-4 mb-3">$1</h1>')
        // Handle unordered lists
        .replace(/^\* (.*$)/gm, '<li class="ml-4">• $1</li>')
        .replace(/^- (.*$)/gm, '<li class="ml-4">• $1</li>')
        // Handle line breaks (reduce spacing)
        .replace(/\n\n+/g, '</p><p class="mt-2">')
        .replace(/\n/g, '<br>')

      // Wrap in paragraph tags if not already wrapped
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
                <span className='text-sm'>Searching documentation...</span>
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
        // Create form event and call the main handler
        const mockEvent = { preventDefault: () => {} } as React.FormEvent
        setInput(message)
        await handleSubmit(mockEvent)
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
                  <Button 
                    variant='ghost' 
                    className='h-8 px-3 flex-1 justify-start min-w-0'
                  >
                    <span className='truncate'>
                      {currentChat?.title || 'New Chat'}
                    </span>
                    <ChevronDown className='h-4 w-4 ml-2 shrink-0' />
                  </Button>
                </DropdownMenuTrigger>
                                  <DropdownMenuContent align='start' className='w-64 z-[110]' sideOffset={8}>
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
                onClick={startNewChat}
                className='h-8 w-8 p-0 ml-2'
                title='New Chat'
              >
                <MessageSquarePlus className='h-4 w-4' />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className='flex-1' ref={scrollAreaRef}>
            {messages.length === 0 ? (
              <div className='flex h-full flex-col items-center justify-center p-8 text-center'>
                <Bot className='mb-4 h-12 w-12 text-muted-foreground' />
                <h3 className='mb-2 font-medium text-sm'>Welcome to Documentation Copilot</h3>
                <p className='mb-4 max-w-xs text-muted-foreground text-xs'>
                  Ask me anything about Sim Studio features, workflows, tools, or how to get
                  started.
                </p>
                <div className='space-y-2 text-left'>
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
            ) : (
              <div className='space-y-1'>{messages.map(renderMessage)}</div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className='border-t p-4'>
            <form onSubmit={handleSubmit} className='flex gap-2'>
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='Ask about Sim Studio documentation...'
                disabled={isLoading}
                className='flex-1'
                autoComplete='off'
              />
              <Button
                type='submit'
                size='icon'
                disabled={!input.trim() || isLoading}
                className='h-10 w-10'
              >
                {isLoading ? (
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
          isLoading={isLoading}
          chats={chats}
          currentChat={currentChat}
          onSelectChat={selectChat}
          onStartNewChat={startNewChat}
          onDeleteChat={handleDeleteChat}
        />
      </>
    )
  }
)

Copilot.displayName = 'Copilot'
