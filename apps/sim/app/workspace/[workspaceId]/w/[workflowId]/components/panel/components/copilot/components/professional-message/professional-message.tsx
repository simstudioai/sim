'use client'

import { type FC, memo, useMemo } from 'react'
import { Bot, CheckCircle, Copy, Loader2, User, XCircle } from 'lucide-react'
import { useTheme } from 'next-themes'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CopilotMessage } from '@/stores/copilot/types'
import type { ToolCallState } from '@/types/tool-call'

interface ProfessionalMessageProps {
  message: CopilotMessage
  isStreaming?: boolean
}

// Inline Tool Call Component
function InlineToolCall({ tool, stepNumber }: { tool: ToolCallState | any; stepNumber?: number }) {
  const getStateIcon = () => {
    switch (tool.state) {
      case 'executing':
        return <Loader2 className='h-3 w-3 animate-spin text-blue-600 dark:text-blue-400' />
      case 'completed':
        return <CheckCircle className='h-3 w-3 text-green-600 dark:text-green-400' />
      case 'ready_for_review':
        return <CheckCircle className='h-3 w-3 text-purple-600 dark:text-purple-400' />
      case 'applied':
        return <CheckCircle className='h-3 w-3 text-green-600 dark:text-green-400' />
      case 'rejected':
        return <XCircle className='h-3 w-3 text-orange-600 dark:text-orange-400' />
      case 'error':
        return <XCircle className='h-3 w-3 text-red-600 dark:text-red-400' />
      default:
        return (
          <div className='h-3 w-3 rounded-full border-2 border-gray-300 dark:border-gray-600' />
        )
    }
  }

  const getStateColors = () => {
    switch (tool.state) {
      case 'executing':
        return 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100'
      case 'completed':
        return 'border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100'
      case 'ready_for_review':
        return 'border-purple-200 bg-purple-50 text-purple-900 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-100'
      case 'applied':
        return 'border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100'
      case 'rejected':
        return 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100'
      case 'error':
        return 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100'
      default:
        return 'border-gray-200 bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
    }
  }

  const formatDuration = (duration?: number) => {
    if (!duration) return ''
    return duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`
  }

  // Special handling for preview workflow and targeted updates
  const isPreviewTool = tool.name === 'preview_workflow' || tool.name === 'targeted_updates'

  if (isPreviewTool) {
    return (
      <div
        className={cn(
          'rounded-xl border-2 p-4 transition-all duration-300',
          tool.state === 'executing' &&
            'border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 dark:border-blue-800 dark:from-blue-950/50 dark:to-indigo-950/50',
          tool.state === 'ready_for_review' &&
            'border-purple-200 bg-gradient-to-r from-purple-50 to-violet-50 dark:border-purple-800 dark:from-purple-950/50 dark:to-violet-950/50',
          tool.state === 'applied' &&
            'border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 dark:border-green-800 dark:from-green-950/50 dark:to-emerald-950/50',
          tool.state === 'rejected' &&
            'border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 dark:border-orange-800 dark:from-orange-950/50 dark:to-amber-950/50',
          tool.state === 'error' &&
            'border-red-200 bg-gradient-to-r from-red-50 to-pink-50 dark:border-red-800 dark:from-red-950/50 dark:to-pink-950/50'
        )}
      >
        <div className='flex items-center gap-3'>
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full',
              tool.state === 'executing' && 'bg-blue-100 dark:bg-blue-900',
              tool.state === 'ready_for_review' && 'bg-purple-100 dark:bg-purple-900',
              tool.state === 'applied' && 'bg-green-100 dark:bg-green-900',
              tool.state === 'rejected' && 'bg-orange-100 dark:bg-orange-900',
              tool.state === 'error' && 'bg-red-100 dark:bg-red-900'
            )}
          >
            {tool.state === 'executing' && (
              <Loader2 className='h-4 w-4 animate-spin text-blue-600 dark:text-blue-400' />
            )}
            {tool.state === 'ready_for_review' && (
              <CheckCircle className='h-4 w-4 text-purple-600 dark:text-purple-400' />
            )}
            {tool.state === 'applied' && (
              <CheckCircle className='h-4 w-4 text-green-600 dark:text-green-400' />
            )}
            {tool.state === 'rejected' && (
              <XCircle className='h-4 w-4 text-orange-600 dark:text-orange-400' />
            )}
            {tool.state === 'error' && (
              <XCircle className='h-4 w-4 text-red-600 dark:text-red-400' />
            )}
          </div>
          <div>
            <div
              className={cn(
                'font-semibold text-sm',
                tool.state === 'executing' && 'text-blue-900 dark:text-blue-100',
                tool.state === 'ready_for_review' && 'text-purple-900 dark:text-purple-100',
                tool.state === 'applied' && 'text-green-900 dark:text-green-100',
                tool.state === 'rejected' && 'text-orange-900 dark:text-orange-100',
                tool.state === 'error' && 'text-red-900 dark:text-red-100'
              )}
            >
              {tool.state === 'executing'
                ? tool.name === 'targeted_updates'
                  ? 'Editing workflow'
                  : 'Building workflow'
                : tool.displayName || tool.name}
            </div>
            <div
              className={cn(
                'text-xs',
                tool.state === 'executing' && 'text-blue-700 dark:text-blue-300',
                tool.state === 'ready_for_review' && 'text-purple-700 dark:text-purple-300',
                tool.state === 'applied' && 'text-green-700 dark:text-green-300',
                tool.state === 'rejected' && 'text-orange-700 dark:text-orange-300',
                tool.state === 'error' && 'text-red-700 dark:text-red-300'
              )}
            >
              {tool.state === 'executing'
                ? tool.name === 'targeted_updates'
                  ? 'Editing workflow...'
                  : 'Building workflow...'
                : tool.state === 'ready_for_review'
                  ? 'Ready for review'
                  : tool.state === 'applied'
                    ? 'Applied changes'
                    : tool.state === 'rejected'
                      ? 'Rejected changes'
                      : tool.name === 'targeted_updates'
                        ? 'Workflow editing failed'
                        : 'Workflow generation failed'}
            </div>
          </div>
          {tool.duration &&
            (tool.state === 'ready_for_review' ||
              tool.state === 'applied' ||
              tool.state === 'rejected') && (
              <Badge variant='secondary' className='ml-auto text-xs'>
                {formatDuration(tool.duration)}
              </Badge>
            )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-all duration-200',
        getStateColors()
      )}
    >
      <div className='flex items-center gap-2'>
        {stepNumber && (
          <div className='flex h-5 w-5 items-center justify-center rounded-full bg-white/70 font-medium text-xs dark:bg-black/20'>
            {stepNumber}
          </div>
        )}
        {getStateIcon()}
      </div>
      <span className='flex-1 font-medium'>{tool.displayName || tool.name}</span>
      {tool.duration && tool.state === 'completed' && (
        <Badge variant='secondary' className='text-xs'>
          {formatDuration(tool.duration)}
        </Badge>
      )}
      {tool.state === 'executing' && tool.progress && (
        <Badge variant='outline' className='text-xs'>
          {tool.progress}
        </Badge>
      )}
    </div>
  )
}

const ProfessionalMessage: FC<ProfessionalMessageProps> = memo(({ message, isStreaming }) => {
  const { theme } = useTheme()
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  const handleCopyContent = () => {
    // Copy clean text content
    navigator.clipboard.writeText(message.content)
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Get clean text content (no processing needed with native SSE)
  const cleanTextContent = useMemo(() => {
    return message.content
  }, [message.content])

  // Custom components for react-markdown with improved styling
  const markdownComponents = {
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''

      if (!inline && language) {
        return (
          <div className='group relative my-4 overflow-hidden rounded-xl border border-border bg-muted/30'>
            <div className='flex items-center justify-between border-border/50 border-b bg-muted/50 px-4 py-2'>
              <span className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                {language}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-0 opacity-70 hover:opacity-100'
                onClick={() => navigator.clipboard.writeText(String(children))}
              >
                <Copy className='h-3 w-3' />
              </Button>
            </div>
            <div className='overflow-x-auto'>
              <SyntaxHighlighter
                style={theme === 'dark' ? oneDark : oneLight}
                language={language}
                PreTag='div'
                className='!m-0 !bg-transparent'
                showLineNumbers={language !== 'bash' && language !== 'shell'}
                wrapLines={true}
                wrapLongLines={true}
                customStyle={{
                  margin: '0 !important',
                  padding: '1rem',
                  fontSize: '0.875rem',
                  background: 'transparent',
                }}
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            </div>
          </div>
        )
      }

      return (
        <code className='rounded-md border bg-muted/80 px-1.5 py-0.5 font-mono text-sm' {...props}>
          {children}
        </code>
      )
    },
    pre: ({ children }: any) => children,
    h1: ({ children }: any) => (
      <h1 className='mt-8 mb-4 border-border border-b pb-2 font-bold text-2xl text-foreground'>
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className='mt-6 mb-3 font-semibold text-foreground text-xl'>{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className='mt-4 mb-2 font-semibold text-foreground text-lg'>{children}</h3>
    ),
    p: ({ children }: any) => (
      <p className='mb-4 text-foreground leading-relaxed last:mb-0'>{children}</p>
    ),
    a: ({ href, children }: any) => (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-600/60 dark:text-blue-400 dark:hover:text-blue-300'
      >
        {children}
      </a>
    ),
    ul: ({ children }: any) => <ul className='mb-4 ml-6 list-disc space-y-1'>{children}</ul>,
    ol: ({ children }: any) => <ol className='mb-4 ml-6 list-decimal space-y-1'>{children}</ol>,
    li: ({ children }: any) => <li className='text-foreground leading-relaxed'>{children}</li>,
    blockquote: ({ children }: any) => (
      <blockquote className='my-4 border-muted-foreground/20 border-l-4 bg-muted/30 py-3 pl-6 text-muted-foreground italic'>
        {children}
      </blockquote>
    ),
    table: ({ children }: any) => (
      <div className='my-4 overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className='border-b bg-muted/50 px-4 py-2 text-left font-semibold'>{children}</th>
    ),
    td: ({ children }: any) => <td className='border-muted/30 border-b px-4 py-2'>{children}</td>,
  }

  if (isUser) {
    return (
      <div className='group mb-6 flex w-full justify-end px-4'>
        <div className='flex max-w-[85%] items-start gap-3'>
          <div className='flex flex-col items-end space-y-2'>
            <div className='overflow-hidden rounded-2xl rounded-tr-lg bg-primary px-4 py-3 text-primary-foreground shadow-sm'>
              <div className='whitespace-pre-wrap text-sm leading-relaxed'>{message.content}</div>
            </div>
            <div className='flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100'>
              <span className='text-muted-foreground text-xs'>
                {formatTimestamp(message.timestamp)}
              </span>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleCopyContent}
                className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
              >
                <Copy className='h-3 w-3' />
              </Button>
            </div>
          </div>
          <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm'>
            <User className='h-4 w-4' />
          </div>
        </div>
      </div>
    )
  }

  if (isAssistant) {
    return (
      <div className='group mb-6 flex w-full justify-start px-4'>
        <div className='flex w-full max-w-[85%] flex-col'>
          {/* Main message content with icon */}
          <div className='flex items-start gap-3'>
            {/* Bot icon */}
            <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-sm'>
              <Bot className={`h-4 w-4 ${isStreaming ? 'animate-pulse' : ''}`} />
            </div>

            {/* Message content */}
            <div className='min-w-0 flex-1'>
              {/* Content blocks in chronological order or fallback to old layout */}
              <div className='space-y-3'>
                {message.contentBlocks && message.contentBlocks.length > 0 ? (
                  // Render content blocks in chronological order
                  <>
                    {message.contentBlocks.map((block, index) => {
                      if (block.type === 'text') {
                        const isLastTextBlock =
                          index === message.contentBlocks!.length - 1 && block.type === 'text'
                        return (
                          <div
                            key={`text-${index}`}
                            className='overflow-hidden rounded-2xl rounded-tl-lg border bg-muted/30 px-4 py-3 shadow-sm'
                          >
                            <div className='prose prose-sm dark:prose-invert max-w-none'>
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {block.content}
                              </ReactMarkdown>
                              {/* Show streaming indicator for the last text block if message is streaming */}
                              {isStreaming && isLastTextBlock && (
                                <span className='ml-1 inline-block h-4 w-2 animate-pulse bg-current opacity-60' />
                              )}
                            </div>
                          </div>
                        )
                      }
                      if (block.type === 'tool_call') {
                        return (
                          <InlineToolCall key={`tool-${block.toolCall.id}`} tool={block.toolCall} />
                        )
                      }
                      return null
                    })}

                    {/* Show streaming indicator if streaming but no text content yet after tool calls */}
                    {isStreaming &&
                      !message.content &&
                      message.contentBlocks.every((block) => block.type === 'tool_call') && (
                        <div className='overflow-hidden rounded-2xl rounded-tl-lg border bg-muted/30 px-4 py-3 shadow-sm'>
                          <div className='flex items-center gap-2 py-2 text-muted-foreground'>
                            <div className='flex space-x-1'>
                              <div
                                className='h-2 w-2 animate-bounce rounded-full bg-current'
                                style={{ animationDelay: '0ms' }}
                              />
                              <div
                                className='h-2 w-2 animate-bounce rounded-full bg-current'
                                style={{ animationDelay: '150ms' }}
                              />
                              <div
                                className='h-2 w-2 animate-bounce rounded-full bg-current'
                                style={{ animationDelay: '300ms' }}
                              />
                            </div>
                            <span className='text-sm'>Thinking...</span>
                          </div>
                        </div>
                      )}
                  </>
                ) : (
                  // Fallback to old layout for messages without content blocks
                  <>
                    {/* Tool calls if available */}
                    {message.toolCalls && message.toolCalls.length > 0 && (
                      <div className='space-y-2'>
                        {message.toolCalls.map((toolCall) => (
                          <InlineToolCall key={toolCall.id} tool={toolCall} />
                        ))}
                      </div>
                    )}

                    {/* Regular text content */}
                    {cleanTextContent && (
                      <div className='overflow-hidden rounded-2xl rounded-tl-lg border bg-muted/30 px-4 py-3 shadow-sm'>
                        <div className='prose prose-sm dark:prose-invert max-w-none'>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {cleanTextContent}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Streaming indicator when no content yet */}
                {!cleanTextContent && !message.contentBlocks?.length && isStreaming && (
                  <div className='overflow-hidden rounded-2xl rounded-tl-lg border bg-muted/30 px-4 py-3 shadow-sm'>
                    <div className='flex items-center gap-2 py-2 text-muted-foreground'>
                      <div className='flex space-x-1'>
                        <div
                          className='h-2 w-2 animate-bounce rounded-full bg-current'
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className='h-2 w-2 animate-bounce rounded-full bg-current'
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className='h-2 w-2 animate-bounce rounded-full bg-current'
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                      <span className='text-sm'>Thinking...</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Timestamp and actions */}
          <div className='mt-2 ml-11 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100'>
            <span className='text-muted-foreground text-xs'>
              {formatTimestamp(message.timestamp)}
            </span>
            {cleanTextContent && (
              <Button
                variant='ghost'
                size='sm'
                onClick={handleCopyContent}
                className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
              >
                <Copy className='h-3 w-3' />
              </Button>
            )}
          </div>

          {/* Citations if available */}
          {message.citations && message.citations.length > 0 && (
            <div className='mt-2 ml-11 space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>Sources:</div>
              <div className='flex flex-wrap gap-2'>
                {message.citations.map((citation) => (
                  <a
                    key={citation.id}
                    href={citation.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground'
                  >
                    {citation.title}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
})

ProfessionalMessage.displayName = 'ProfessionalMessage'

export { ProfessionalMessage }
