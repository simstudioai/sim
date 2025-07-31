'use client'

import { type FC, memo, useEffect, useMemo, useState } from 'react'
import {
  Check,
  CheckCircle,
  Clipboard,
  Code,
  Copy,
  Database,
  Eye,
  FileText,
  Globe,
  History,
  Lightbulb,
  Loader2,
  RotateCcw,
  Search,
  Settings,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { COPILOT_TOOL_IDS } from '@/stores/copilot/constants'
import type { CopilotMessage } from '@/stores/copilot/types'
import type { ToolCallState } from '@/types/tool-call'
import { useCopilotStore } from '@/stores/copilot/store'

interface ProfessionalMessageProps {
  message: CopilotMessage
  isStreaming?: boolean
}

// Maximum character length for a word before it's broken up
const MAX_WORD_LENGTH = 25

const WordWrap = ({ text }: { text: string }) => {
  if (!text) return null

  // Split text into words, keeping spaces and punctuation
  const parts = text.split(/(\s+)/g)

  return (
    <>
      {parts.map((part, index) => {
        // If the part is whitespace or shorter than the max length, render it as is
        if (part.match(/\s+/) || part.length <= MAX_WORD_LENGTH) {
          return <span key={index}>{part}</span>
        }

        // For long words, break them up into chunks
        const chunks = []
        for (let i = 0; i < part.length; i += MAX_WORD_LENGTH) {
          chunks.push(part.substring(i, i + MAX_WORD_LENGTH))
        }

        return (
          <span key={index} className='break-all'>
            {chunks.map((chunk, chunkIndex) => (
              <span key={chunkIndex}>{chunk}</span>
            ))}
          </span>
        )
      })}
    </>
  )
}

// Inline Tool Call Component
function InlineToolCall({ tool, stepNumber }: { tool: ToolCallState | any; stepNumber?: number }) {
  const getToolIcon = () => {
    const displayName = tool.displayName || tool.name || ''
    const lowerName = displayName.toLowerCase()

    if (lowerName.includes('analyz') && lowerName.includes('workflow')) {
      return <Search className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('block') && lowerName.includes('information')) {
      return <Eye className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('structure')) {
      return <Search className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('build') || lowerName.includes('creat')) {
      return <Wrench className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('search') || lowerName.includes('find')) {
      return <Search className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('edit') || lowerName.includes('modif')) {
      return <Code className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('doc') || lowerName.includes('help')) {
      return <FileText className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('environment') || lowerName.includes('variable')) {
      return <Settings className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('tool') || lowerName.includes('method')) {
      return <Zap className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('workflow') && lowerName.includes('console')) {
      return <Database className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('online') || lowerName.includes('web')) {
      return <Globe className='h-3 w-3 text-muted-foreground' />
    }

    // Default icon
    return <Lightbulb className='h-3 w-3 text-muted-foreground' />
  }

  const getStateIcon = () => {
    switch (tool.state) {
      case 'executing':
        return <Loader2 className='h-3 w-3 animate-spin text-muted-foreground' />
      case 'completed':
        return <Search className='h-3 w-3 text-muted-foreground' />
      case 'ready_for_review':
        return <Search className='h-3 w-3 text-muted-foreground' />
      case 'applied':
        return <Search className='h-3 w-3 text-muted-foreground' />
      case 'rejected':
        return <XCircle className='h-3 w-3 text-muted-foreground' />
      case 'aborted':
        return <XCircle className='h-3 w-3 text-muted-foreground' />
      case 'error':
        return <XCircle className='h-3 w-3 text-muted-foreground' />
      default:
        return getToolIcon()
    }
  }

  // Special handling for preview workflow and targeted updates
  const isPreviewTool =
    tool.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW || tool.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW

  if (isPreviewTool) {
    return (
      <div className='rounded-xl border-2 border-muted bg-muted/30 p-4 transition-all duration-300'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted'>
            {tool.state === 'executing' && (
              <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
            )}
            {tool.state === 'ready_for_review' && (
              <CheckCircle className='h-4 w-4 text-muted-foreground' />
            )}
            {tool.state === 'applied' && <CheckCircle className='h-4 w-4 text-muted-foreground' />}
            {tool.state === 'rejected' && <XCircle className='h-4 w-4 text-muted-foreground' />}
            {tool.state === 'aborted' && <XCircle className='h-4 w-4 text-muted-foreground' />}
            {tool.state === 'error' && <XCircle className='h-4 w-4 text-muted-foreground' />}
          </div>
          <div className='flex-1'>
            <div className='font-semibold text-muted-foreground text-sm'>
              {tool.state === 'executing'
                ? tool.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
                  ? 'Editing workflow'
                  : 'Building workflow'
                : tool.displayName || tool.name}
            </div>
            <div className='text-muted-foreground text-xs'>
              {tool.state === 'executing'
                ? tool.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
                  ? 'Editing workflow...'
                  : 'Building workflow...'
                : tool.state === 'ready_for_review'
                  ? 'Ready for review'
                  : tool.state === 'applied'
                    ? 'Applied changes'
                    : tool.state === 'rejected'
                      ? 'Rejected changes'
                      : tool.state === 'aborted'
                        ? 'Aborted'
                        : tool.name === COPILOT_TOOL_IDS.EDIT_WORKFLOW
                          ? 'Workflow editing failed'
                          : 'Workflow generation failed'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2 py-1 text-muted-foreground'>
      <div className='flex-shrink-0'>{getStateIcon()}</div>
      <span className='text-sm'>{tool.displayName || tool.name}</span>
    </div>
  )
}

const ProfessionalMessage: FC<ProfessionalMessageProps> = memo(({ message, isStreaming }) => {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showUpvoteSuccess, setShowUpvoteSuccess] = useState(false)
  const [showDownvoteSuccess, setShowDownvoteSuccess] = useState(false)

  // Get checkpoint functionality from copilot store
  const { 
    messageCheckpoints: allMessageCheckpoints,
    revertToCheckpoint, 
    isRevertingCheckpoint 
  } = useCopilotStore()
  
  // Get checkpoints for this message if it's a user message
  const messageCheckpoints = isUser ? (allMessageCheckpoints[message.id] || []) : []
  const hasCheckpoints = messageCheckpoints.length > 0

  const handleCopyContent = () => {
    // Copy clean text content
    navigator.clipboard.writeText(message.content)
    setShowCopySuccess(true)
  }

  const handleUpvote = () => {
    // Reset downvote if it was active
    setShowDownvoteSuccess(false)
    setShowUpvoteSuccess(true)
  }

  const handleDownvote = () => {
    // Reset upvote if it was active
    setShowUpvoteSuccess(false)
    setShowDownvoteSuccess(true)
  }

  const handleRevertToCheckpoint = async () => {
    if (messageCheckpoints.length > 0) {
      // Use the most recent checkpoint for this message
      const latestCheckpoint = messageCheckpoints[0]
      try {
        await revertToCheckpoint(latestCheckpoint.id)
      } catch (error) {
        console.error('Failed to revert to checkpoint:', error)
      }
    }
  }

  useEffect(() => {
    if (showCopySuccess) {
      const timer = setTimeout(() => {
        setShowCopySuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showCopySuccess])

  useEffect(() => {
    if (showUpvoteSuccess) {
      const timer = setTimeout(() => {
        setShowUpvoteSuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showUpvoteSuccess])

  useEffect(() => {
    if (showDownvoteSuccess) {
      const timer = setTimeout(() => {
        setShowDownvoteSuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showDownvoteSuccess])

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Get clean text content with double newline parsing
  const cleanTextContent = useMemo(() => {
    if (!message.content) return ''

    // Parse out excessive newlines (more than 2 consecutive newlines)
    return message.content.replace(/\n{3,}/g, '\n\n')
  }, [message.content])

  // Custom components for react-markdown with improved styling
  const markdownComponents = {
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''

      if (!inline && language) {
        return (
          <div className='group relative overflow-hidden rounded-lg border border-border bg-muted/30'>
            <div className='flex items-center justify-between border-border/50 border-b bg-muted/50 px-3 py-1'>
              <span className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                {language}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='h-4 w-4 p-0 opacity-70 hover:opacity-100'
                onClick={() => navigator.clipboard.writeText(String(children))}
              >
                <Copy className='h-3 w-3' />
              </Button>
            </div>
            <div className='overflow-hidden'>
              <pre className='m-0 overflow-hidden whitespace-pre-wrap break-all p-2 font-mono text-sm leading-relaxed'>
                <code className='break-all font-mono text-sm'>
                  {String(children).replace(/\n$/, '')}
                </code>
              </pre>
            </div>
          </div>
        )
      }

      return (
        <code
          className='break-words rounded-md border bg-muted/80 px-1.5 py-0.5 font-mono text-sm'
          {...props}
        >
          {children}
        </code>
      )
    },
    pre: ({ children }: any) => children,
    h1: ({ children }: any) => (
      <h1 className='mt-3 mb-2 font-bold text-base text-foreground leading-tight first:mt-0'>
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className='mt-2 mb-1 font-semibold text-foreground text-sm leading-tight'>{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className='mt-2 mb-1 font-semibold text-foreground text-sm leading-tight'>{children}</h3>
    ),
    p: ({ children }: any) => (
      <p className='mb-[0.025rem] text-foreground leading-tight last:mb-0'>{children}</p>
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
    ul: ({ children }: any) => (
      <div className='border-muted-foreground/20 border-l-4 bg-muted/30 pl-3 py-1 my-1'>
        <ul className='list-disc space-y-0 leading-tight pl-4'>{children}</ul>
      </div>
    ),
    ol: ({ children }: any) => (
      <div className='border-muted-foreground/20 border-l-4 bg-muted/30 pl-3 py-1 my-1'>
        <ol className='list-decimal space-y-0 leading-tight pl-4'>{children}</ol>
      </div>
    ),
    li: ({ children }: any) => <li className='text-foreground leading-tight'>{children}</li>,
    blockquote: ({ children }: any) => (
      <blockquote className='border-muted-foreground/20 border-l-4 bg-muted/30 pl-3 text-muted-foreground italic leading-tight [&_div:has(ul)]:border-0 [&_div:has(ul)]:bg-transparent [&_div:has(ol)]:border-0 [&_div:has(ol)]:bg-transparent'>
        {children}
      </blockquote>
    ),
    table: ({ children }: any) => (
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className='border-b bg-muted/50 px-2 text-left font-semibold text-sm leading-tight'>
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className='border-muted/30 border-b px-2 text-sm leading-tight'>{children}</td>
    ),
  }

  if (isUser) {
    return (
      <div className='w-full py-2'>
        <div className='flex justify-end'>
          <div className='max-w-[80%]'>
            <div className='rounded-[10px] px-3 py-2' style={{ backgroundColor: 'rgba(128, 47, 255, 0.08)' }}>
              <div className='whitespace-pre-wrap break-words font-normal text-foreground text-sm leading-tight'>
                <WordWrap text={message.content} />
              </div>
              {hasCheckpoints && (
                <div className='mt-2 flex items-center justify-end gap-2'>
                  <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                    <History className='h-3 w-3' />
                    <span>{messageCheckpoints.length} checkpoint{messageCheckpoints.length > 1 ? 's' : ''}</span>
                  </div>
                  <button
                    onClick={handleRevertToCheckpoint}
                    disabled={isRevertingCheckpoint}
                    className='flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                    title='Revert workflow to this state'
                  >
                    {isRevertingCheckpoint ? (
                      <Loader2 className='h-3 w-3 animate-spin' />
                    ) : (
                      <RotateCcw className='h-3 w-3' />
                    )}
                    Revert
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isAssistant) {
    return (
      <div className='w-full py-2 pl-[2px]'>
        <div className='space-y-2'>
          {/* Content blocks in chronological order or fallback to old layout */}
          {message.contentBlocks && message.contentBlocks.length > 0 ? (
            // Render content blocks in chronological order
            <>
              {message.contentBlocks.map((block, index) => {
                if (block.type === 'text') {
                  const isLastTextBlock =
                    index === message.contentBlocks!.length - 1 && block.type === 'text'
                  // Clean content for this text block
                  const cleanBlockContent = block.content.replace(/\n{3,}/g, '\n\n')
                  return (
                    <div key={`text-${index}`} className='w-full'>
                      <div className='overflow-wrap-anywhere relative whitespace-normal break-normal font-normal text-sm leading-tight'>
                        <div className='whitespace-pre-wrap break-words text-foreground'>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {cleanBlockContent}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )
                }
                if (block.type === 'tool_call') {
                  return <InlineToolCall key={`tool-${block.toolCall.id}`} tool={block.toolCall} />
                }
                return null
              })}

              {/* Show streaming indicator if streaming but no text content yet after tool calls */}
              {isStreaming &&
                !message.content &&
                message.contentBlocks.every((block) => block.type === 'tool_call') && (
                  <div className='flex items-center py-1 text-muted-foreground'>
                    <div className='flex space-x-0.5'>
                      <div
                        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
                        style={{ animationDelay: '0ms' }}
                      />
                      <div
                        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
                        style={{ animationDelay: '100ms' }}
                      />
                      <div
                        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
                        style={{ animationDelay: '200ms' }}
                      />
                    </div>
                  </div>
                )}
            </>
          ) : (
            // Fallback to old layout for messages without content blocks
            <>
              {/* Tool calls if available */}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className='mb-2'>
                  {message.toolCalls.map((toolCall) => (
                    <InlineToolCall key={toolCall.id} tool={toolCall} />
                  ))}
                </div>
              )}

              {/* Regular text content */}
              {cleanTextContent && (
                <div className='w-full'>
                  <div className='overflow-wrap-anywhere relative whitespace-normal break-normal font-normal text-sm leading-tight'>
                    <div className='whitespace-pre-wrap break-words text-foreground'>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {cleanTextContent}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Streaming indicator when no content yet */}
          {!cleanTextContent && !message.contentBlocks?.length && isStreaming && (
            <div className='flex items-center py-2 text-muted-foreground'>
              <div className='flex space-x-0.5'>
                <div
                  className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
                  style={{ animationDelay: '100ms' }}
                />
                <div
                  className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
                  style={{ animationDelay: '200ms' }}
                />
              </div>
            </div>
          )}

          {/* Action buttons for completed messages */}
          {!isStreaming && cleanTextContent && (
            <div className='flex items-center gap-2'>
              <button
                onClick={handleCopyContent}
                className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                style={{ color: 'var(--base-muted-foreground)' }}
                title='Copy'
              >
                {showCopySuccess ? (
                  <Check className='h-3 w-3 text-gray-500' strokeWidth={2} />
                ) : (
                  <Clipboard className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
              <button
                onClick={handleUpvote}
                className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                style={{ color: 'var(--base-muted-foreground)' }}
                title='Upvote'
              >
                {showUpvoteSuccess ? (
                  <Check className='h-3 w-3 text-gray-500' strokeWidth={2} />
                ) : (
                  <ThumbsUp className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
              <button
                onClick={handleDownvote}
                className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                style={{ color: 'var(--base-muted-foreground)' }}
                title='Downvote'
              >
                {showDownvoteSuccess ? (
                  <Check className='h-3 w-3 text-gray-500' strokeWidth={2} />
                ) : (
                  <ThumbsDown className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
            </div>
          )}

          {/* Citations if available */}
          {message.citations && message.citations.length > 0 && (
            <div className='pt-1'>
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
