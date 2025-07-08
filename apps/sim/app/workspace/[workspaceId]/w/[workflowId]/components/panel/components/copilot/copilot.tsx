'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Bot, Loader2, Send, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console-logger'
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
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: {
    title: string
    document: string
    link: string
    similarity: number
  }[]
  isLoading?: boolean
  isStreaming?: boolean
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
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Expose clear function to parent
    useImperativeHandle(
      ref,
      () => ({
        clearMessages: () => {
          setMessages([])
          logger.info('Copilot messages cleared')
        },
      }),
      []
    )

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

    const handleSubmit = useCallback(
      async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || isLoading) return

        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: input.trim(),
          timestamp: new Date(),
        }

        const streamingMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
        }

        setMessages((prev) => [...prev, userMessage, streamingMessage])
        const query = input.trim()
        setInput('')
        setIsLoading(true)

        try {
          logger.info('Sending docs RAG query:', { query })

          const response = await fetch('/api/docs/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              topK: 5,
              stream: true,
            }),
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`)
          }

          // Handle streaming response
          if (response.headers.get('content-type')?.includes('text/event-stream')) {
            const reader = response.body?.getReader()
            const decoder = new TextDecoder()
            let accumulatedContent = ''
            let sources: any[] = []

            if (!reader) {
              throw new Error('Failed to get response reader')
            }

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
                    } else if (data.type === 'content') {
                      accumulatedContent += data.content

                      // Update the streaming message with accumulated content
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === streamingMessage.id
                            ? { ...msg, content: accumulatedContent, sources }
                            : msg
                        )
                      )
                    } else if (data.type === 'done') {
                      // Finish streaming
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === streamingMessage.id
                            ? { ...msg, isStreaming: false, sources }
                            : msg
                        )
                      )
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
            // Fallback to non-streaming response
            const data = await response.json()

            const assistantMessage: Message = {
              id: streamingMessage.id,
              role: 'assistant',
              content: data.response || 'Sorry, I could not generate a response.',
              timestamp: new Date(),
              sources: data.sources || [],
              isStreaming: false,
            }

            setMessages((prev) => prev.slice(0, -1).concat(assistantMessage))
          }
        } catch (error) {
          logger.error('Docs RAG error:', error)

          const errorMessage: Message = {
            id: streamingMessage.id,
            role: 'assistant',
            content:
              'Sorry, I encountered an error while searching the documentation. Please try again.',
            timestamp: new Date(),
            isStreaming: false,
          }

          setMessages((prev) => prev.slice(0, -1).concat(errorMessage))
        } finally {
          setIsLoading(false)
        }
      },
      [input, isLoading]
    )

    const formatTimestamp = (date: Date) => {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    // Function to render content with inline hyperlinked citations and basic markdown
    const renderContentWithCitations = (content: string, sources: Message['sources'] = []) => {
      if (!content) return content

      let processedContent = content

      // Replace {cite:1}, {cite:2}, etc. with clickable citation icons
      processedContent = processedContent.replace(/\{cite:(\d+)\}/g, (match, num) => {
        const sourceIndex = Number.parseInt(num) - 1
        const source = sources[sourceIndex]

        if (source) {
          return `<a href="${source.link}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center ml-1 text-primary hover:text-primary/80 transition-colors text-sm" title="${source.title}">↗</a>`
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

    const renderMessage = (message: Message) => {
      if (message.isStreaming && !message.content) {
        return (
          <div key={message.id} className='flex gap-3 p-4'>
            <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary'>
              <Bot className='h-4 w-4 text-primary-foreground' />
            </div>
            <div className='flex-1'>
              <div className='mb-2 flex items-center gap-2'>
                <span className='font-medium text-sm'>Copilot</span>
                <span className='text-muted-foreground text-xs'>
                  {formatTimestamp(message.timestamp)}
                </span>
              </div>
              <div className='flex items-center gap-2 text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' />
                <span className='text-sm'>Searching documentation...</span>
              </div>
            </div>
          </div>
        )
      }

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
              {message.isStreaming && (
                <div className='flex items-center gap-1'>
                  <Loader2 className='h-3 w-3 animate-spin text-primary' />
                  <span className='text-primary text-xs'>Responding...</span>
                </div>
              )}
            </div>

            {/* Enhanced content rendering with inline citations */}
            <div className='prose prose-sm dark:prose-invert max-w-none'>
              <div
                className='text-foreground text-sm leading-normal'
                dangerouslySetInnerHTML={{
                  __html: renderContentWithCitations(message.content, message.sources),
                }}
              />
            </div>

            {/* Streaming cursor */}
            {message.isStreaming && message.content && (
              <span className='ml-1 inline-block h-4 w-2 animate-pulse bg-primary' />
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
      timestamp: msg.timestamp,
      citations: msg.sources?.map((source, index) => ({
        id: index + 1,
        title: source.title,
        url: source.link,
      })),
    }))

    // Handle modal message sending
    const handleModalSendMessage = useCallback(async (message: string) => {
      // Use the same handleSubmit logic but with the message parameter
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date(),
      }

      const streamingMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      }

      setMessages((prev) => [...prev, userMessage, streamingMessage])
      setIsLoading(true)

      try {
        logger.info('Sending docs RAG query:', { query: message })

        const response = await fetch('/api/docs/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: message,
            topK: 5,
            stream: true,
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`)
        }

        // Handle streaming response
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          const reader = response.body?.getReader()
          const decoder = new TextDecoder()
          let accumulatedContent = ''
          let sources: any[] = []

          if (!reader) {
            throw new Error('Failed to get response reader')
          }

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
                  } else if (data.type === 'content') {
                    accumulatedContent += data.content

                    // Update the streaming message with accumulated content
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === streamingMessage.id
                          ? { ...msg, content: accumulatedContent, sources }
                          : msg
                      )
                    )
                  } else if (data.type === 'done') {
                    // Finish streaming
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === streamingMessage.id
                          ? { ...msg, isStreaming: false, sources }
                          : msg
                      )
                    )
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
          // Fallback to non-streaming response
          const data = await response.json()

          const assistantMessage: Message = {
            id: streamingMessage.id,
            role: 'assistant',
            content: data.response || 'Sorry, I could not generate a response.',
            timestamp: new Date(),
            sources: data.sources || [],
            isStreaming: false,
          }

          setMessages((prev) => prev.slice(0, -1).concat(assistantMessage))
        }
      } catch (error) {
        logger.error('Docs RAG error:', error)

        const errorMessage: Message = {
          id: streamingMessage.id,
          role: 'assistant',
          content:
            'Sorry, I encountered an error while searching the documentation. Please try again.',
          timestamp: new Date(),
          isStreaming: false,
        }

        setMessages((prev) => prev.slice(0, -1).concat(errorMessage))
      } finally {
        setIsLoading(false)
      }
    }, [])

    return (
      <>
        <div className='flex h-full flex-col'>
          {/* Header */}
          <div className='border-b p-4'>
            <div className='flex items-center gap-2'>
              <Bot className='h-5 w-5 text-primary' />
              <div>
                <h3 className='font-medium text-sm'>Documentation Copilot</h3>
                <p className='text-muted-foreground text-xs'>Ask questions about Sim Studio</p>
              </div>
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
        />
      </>
    )
  }
)

Copilot.displayName = 'Copilot'
