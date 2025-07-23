'use client'

import { type FC, memo, useMemo } from 'react'
import { Bot, Copy, User } from 'lucide-react'
import { useTheme } from 'next-themes'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { ToolCallCompletion, ToolCallExecution } from '@/components/ui/tool-call'
import { parseMessageContent, stripToolCallIndicators } from '@/lib/tool-call-parser'
import type { CopilotMessage } from '@/stores/copilot/types'

interface ProfessionalMessageProps {
  message: CopilotMessage
  isStreaming?: boolean
}

const ProfessionalMessage: FC<ProfessionalMessageProps> = memo(({ message, isStreaming }) => {
  const { theme } = useTheme()
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'

  const handleCopyContent = () => {
    // Copy clean text content without tool call indicators
    const contentToCopy = isAssistant ? stripToolCallIndicators(message.content) : message.content
    navigator.clipboard.writeText(contentToCopy)
  }

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Parse message content to separate text and tool calls
  const parsedContent = useMemo(() => {
    if (isAssistant && message.content) {
      return parseMessageContent(message.content)
    }
    return null
  }, [isAssistant, message.content])

  // Get clean text content without tool call indicators
  const cleanTextContent = useMemo(() => {
    if (isAssistant && message.content) {
      return stripToolCallIndicators(message.content)
    }
    return message.content
  }, [isAssistant, message.content])

  // Custom components for react-markdown
  const markdownComponents = {
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''

      if (!inline && language) {
        return (
          <div className='group relative my-3 w-full max-w-full overflow-hidden rounded-lg border bg-muted/30'>
            <div
              className='w-full max-w-full overflow-x-auto'
              style={{ maxWidth: '100%', width: '100%' }}
            >
              <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
                <SyntaxHighlighter
                  style={theme === 'dark' ? oneDark : oneLight}
                  language={language}
                  PreTag='div'
                  className='!m-0 !bg-transparent !max-w-full !w-full'
                  showLineNumbers={language !== 'bash' && language !== 'shell'}
                  wrapLines={true}
                  wrapLongLines={true}
                  customStyle={{
                    margin: '0 !important',
                    padding: '1rem',
                    fontSize: '0.875rem',
                    maxWidth: '100% !important',
                    width: '100% !important',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                  codeTagProps={{
                    style: {
                      maxWidth: '100%',
                      overflow: 'hidden',
                      wordBreak: 'break-all',
                      whiteSpace: 'pre-wrap',
                    },
                  }}
                  {...props}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              </div>
            </div>
            <Button
              variant='ghost'
              size='sm'
              className='absolute top-2 right-2 h-8 w-8 p-0 opacity-0 transition-opacity group-hover:opacity-100'
              onClick={() => navigator.clipboard.writeText(String(children))}
            >
              <Copy className='h-3 w-3' />
            </Button>
          </div>
        )
      }

      return (
        <code
          className='break-all rounded border bg-muted/80 px-1.5 py-0.5 font-mono text-sm'
          {...props}
        >
          {children}
        </code>
      )
    },
    pre: ({ children }: any) => (
      <div className='my-3 w-full max-w-full overflow-x-auto rounded-lg border bg-muted/30'>
        {children}
      </div>
    ),
    h1: ({ children }: any) => (
      <h1 className='mt-6 mb-3 break-words border-b pb-2 font-bold text-foreground text-xl'>
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className='mt-5 mb-2 break-words font-semibold text-foreground text-lg'>{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className='mt-4 mb-2 break-words font-semibold text-base text-foreground'>{children}</h3>
    ),
    p: ({ children }: any) => (
      <p className='mb-3 break-words text-foreground text-sm leading-relaxed last:mb-0'>
        {children}
      </p>
    ),
    a: ({ href, children }: any) => (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='break-all font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition-colors hover:text-blue-800 hover:decoration-blue-600/60 dark:text-blue-400 dark:hover:text-blue-300'
      >
        {children}
      </a>
    ),
    ul: ({ children }: any) => (
      <ul className='mb-3 ml-4 list-outside list-disc space-y-1 break-words'>{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className='mb-3 ml-4 list-outside list-decimal space-y-1 break-words'>{children}</ol>
    ),
    li: ({ children }: any) => (
      <li className='break-words text-foreground text-sm leading-relaxed'>{children}</li>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className='my-3 break-words rounded-r-lg border-muted-foreground/20 border-l-4 bg-muted/30 py-2 pl-4 text-muted-foreground italic'>
        {children}
      </blockquote>
    ),
    table: ({ children }: any) => (
      <div className='my-3 w-full max-w-full overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className='break-words border-b bg-muted/50 px-3 py-2 text-left font-semibold'>
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className='break-words border-muted/30 border-b px-3 py-2'>{children}</td>
    ),
  }

  if (isUser) {
    return (
      <div className='group flex w-full max-w-full justify-end overflow-hidden px-4 py-3'>
        <div className='flex max-w-[85%] items-start gap-3'>
          <div className='flex flex-col items-end space-y-1'>
            <div className='max-w-full overflow-hidden rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-primary-foreground shadow-sm'>
              <div className='overflow-hidden whitespace-pre-wrap break-words text-sm leading-relaxed'>
                {message.content}
              </div>
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
      <>
        <style>{`
          .message-container .prose pre {
            max-width: 100% !important;
            overflow-x: auto !important;
          }
          .message-container .prose code {
            max-width: 100% !important;
            word-break: break-all !important;
            white-space: pre-wrap !important;
          }
          .message-container div[class*="language-"] {
            max-width: 100% !important;
            overflow: hidden !important;
          }
          .message-container div[class*="language-"] > div {
            max-width: 100% !important;
            overflow-x: auto !important;
          }
          .message-container div[class*="language-"] pre {
            max-width: 100% !important;
            overflow-x: auto !important;
            white-space: pre-wrap !important;
            word-break: break-all !important;
          }
          .aggressive-pulse {
            animation: aggressivePulse 1s ease-in-out infinite;
          }
          @keyframes aggressivePulse {
            0%, 100% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.4;
              transform: scale(0.95);
            }
          }
        `}</style>
        <div className='message-container group flex w-full max-w-full justify-start overflow-hidden px-4 py-3'>
          <div className='flex w-full max-w-[85%] flex-col'>
            {/* Main message content with icon */}
            <div className='mb-3 flex items-end gap-3'>
              {/* Bot icon aligned with bottom of message bubble */}
              <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-sm'>
                <Bot className={`h-4 w-4 ${isStreaming ? 'aggressive-pulse' : ''}`} />
              </div>

              {/* Message content */}
              <div className='flex min-w-0 flex-1 flex-col items-start space-y-2'>
                {/* Inline content rendering - tool calls and text in order */}
                {parsedContent?.inlineContent && parsedContent.inlineContent.length > 0 ? (
                  <div className='w-full max-w-full space-y-2'>
                    {parsedContent.inlineContent.map((item, index) => {
                      if (item.type === 'tool_call' && item.toolCall) {
                        const toolCall = item.toolCall
                        return (
                          <div key={`${toolCall.id}-${index}`}>
                            {toolCall.state === 'detecting' && (
                              <div className='flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-800 dark:bg-blue-950'>
                                <div className='h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400' />
                                <span className='text-blue-800 dark:text-blue-200'>
                                  Detecting {toolCall.displayName || toolCall.name}...
                                </span>
                              </div>
                            )}
                            {toolCall.state === 'executing' && (
                              <ToolCallExecution toolCall={toolCall} isCompact={false} />
                            )}
                            {(toolCall.state === 'completed' || toolCall.state === 'error') && (
                              <ToolCallCompletion toolCall={toolCall} isCompact={false} />
                            )}
                          </div>
                        )
                      }
                      if (item.type === 'text' && item.content.trim()) {
                        return (
                          <div
                            key={`text-${index}`}
                            className='w-full max-w-full overflow-hidden rounded-2xl rounded-tl-md border bg-muted/50 px-4 py-3 shadow-sm'
                          >
                            <div
                              className='prose prose-sm dark:prose-invert w-full max-w-none overflow-hidden'
                              style={{
                                maxWidth: '100%',
                                width: '100%',
                                overflow: 'hidden',
                                wordBreak: 'break-word',
                              }}
                            >
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {item.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                ) : (
                  /* Fallback for empty content or streaming */
                  <div className='w-full max-w-full overflow-hidden rounded-2xl rounded-tl-md border bg-muted/50 px-4 py-3 shadow-sm'>
                    {cleanTextContent ? (
                      <div
                        className='prose prose-sm dark:prose-invert w-full max-w-none overflow-hidden'
                        style={{
                          maxWidth: '100%',
                          width: '100%',
                          overflow: 'hidden',
                          wordBreak: 'break-word',
                        }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {cleanTextContent}
                        </ReactMarkdown>
                      </div>
                    ) : isStreaming ? (
                      <div className='flex items-center gap-2 py-1 text-muted-foreground'>
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
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Timestamp and actions - separate from main content */}
            <div className='ml-11 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100'>
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
              <div className='mt-2 ml-11 max-w-full space-y-1'>
                <div className='font-medium text-muted-foreground text-xs'>Sources:</div>
                <div className='flex flex-wrap gap-1'>
                  {message.citations.map((citation) => (
                    <a
                      key={citation.id}
                      href={citation.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex max-w-full items-center break-all rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground'
                    >
                      {citation.title}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  return null
})

ProfessionalMessage.displayName = 'ProfessionalMessage'

export { ProfessionalMessage }
