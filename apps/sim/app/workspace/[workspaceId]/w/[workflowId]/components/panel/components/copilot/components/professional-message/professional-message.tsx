'use client'

import React, { type FC, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clipboard, Copy, Loader2, RotateCcw, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { COPILOT_TOOL_DISPLAY_NAMES } from '@/stores/constants'
import { useCopilotStore } from '@/stores/copilot/store'
import type { CopilotMessage } from '@/stores/copilot/types'
import { InlineToolCall } from '../../lib/tools/inline-tool-call'

interface ProfessionalMessageProps {
  message: CopilotMessage
  isStreaming?: boolean
}

// Link component with preview (from CopilotMarkdownRenderer)
function LinkWithPreview({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <a
          href={href}
          className='text-blue-600 hover:underline dark:text-blue-400'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent side='top' align='center' sideOffset={5} className='max-w-sm p-3'>
        <span className='text-sm'>{href}</span>
      </TooltipContent>
    </Tooltip>
  )
}

// Memoized streaming indicator component for better performance
const StreamingIndicator = memo(() => (
  <div className='flex items-center py-1 text-muted-foreground transition-opacity duration-200 ease-in-out'>
    <div className='flex space-x-0.5'>
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0ms', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.15s', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.3s', animationDuration: '1.2s' }}
      />
    </div>
  </div>
))

StreamingIndicator.displayName = 'StreamingIndicator'

// Smooth streaming text component with typewriter effect
interface SmoothStreamingTextProps {
  content: string
  isStreaming: boolean
  markdownComponents: any
}

const SmoothStreamingText = memo(
  ({ content, isStreaming, markdownComponents }: SmoothStreamingTextProps) => {
    const [displayedContent, setDisplayedContent] = useState('')
    const contentRef = useRef(content)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const indexRef = useRef(0)
    const streamingStartTimeRef = useRef<number | null>(null)
    const isAnimatingRef = useRef(false)

    useEffect(() => {
      // Update content reference
      contentRef.current = content

      if (content.length === 0) {
        setDisplayedContent('')
        indexRef.current = 0
        streamingStartTimeRef.current = null
        return
      }

      if (isStreaming) {
        // Start timing when streaming begins
        if (streamingStartTimeRef.current === null) {
          streamingStartTimeRef.current = Date.now()
        }

        // Continue animation if there's more content to show
        if (indexRef.current < content.length) {
          const animateText = () => {
            const currentContent = contentRef.current
            const currentIndex = indexRef.current

            if (currentIndex < currentContent.length) {
              // Add characters one by one for true character-by-character streaming
              const chunkSize = 1
              const newDisplayed = currentContent.slice(0, currentIndex + chunkSize)

              setDisplayedContent(newDisplayed)
              indexRef.current = currentIndex + chunkSize

              // Consistent fast speed for all characters
              const delay = 3 // Consistent fast delay in ms for all characters

              timeoutRef.current = setTimeout(animateText, delay)
            } else {
              // Animation complete
              isAnimatingRef.current = false
            }
          }

          // Only start new animation if not already animating
          if (!isAnimatingRef.current) {
            // Clear any existing animation
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current)
            }

            isAnimatingRef.current = true
            // Continue animation from current position
            animateText()
          }
        }
      } else {
        // Not streaming, show all content immediately and reset timing
        setDisplayedContent(content)
        indexRef.current = content.length
        isAnimatingRef.current = false
        streamingStartTimeRef.current = null
      }

      // Cleanup on unmount
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        isAnimatingRef.current = false
      }
    }, [content, isStreaming])

    return (
      <div className='relative' style={{ minHeight: '1.25rem' }}>
        <div className='space-y-4 break-words font-geist-sans text-[#0D0D0D] text-base leading-relaxed dark:text-gray-100'>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {displayedContent}
          </ReactMarkdown>
        </div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Prevent re-renders during streaming unless content actually changed
    return (
      prevProps.content === nextProps.content && prevProps.isStreaming === nextProps.isStreaming
      // markdownComponents is now memoized so no need to compare
    )
  }
)

SmoothStreamingText.displayName = 'SmoothStreamingText'

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

// Helper function to get tool display name based on state
function getToolDisplayName(toolName: string): string {
  return COPILOT_TOOL_DISPLAY_NAMES[toolName] || toolName
}

const ProfessionalMessage: FC<ProfessionalMessageProps> = memo(
  ({ message, isStreaming }) => {
    const isUser = message.role === 'user'
    const isAssistant = message.role === 'assistant'
    const [showCopySuccess, setShowCopySuccess] = useState(false)
    const [showUpvoteSuccess, setShowUpvoteSuccess] = useState(false)
    const [showDownvoteSuccess, setShowDownvoteSuccess] = useState(false)
    const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false)

    // Get checkpoint functionality from copilot store
    const {
      messageCheckpoints: allMessageCheckpoints,
      revertToCheckpoint,
      isRevertingCheckpoint,
    } = useCopilotStore()

    // Get checkpoints for this message if it's a user message
    const messageCheckpoints = isUser ? allMessageCheckpoints[message.id] || [] : []
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

    const handleRevertToCheckpoint = () => {
      setShowRestoreConfirmation(true)
    }

    const handleConfirmRevert = async () => {
      if (messageCheckpoints.length > 0) {
        // Use the most recent checkpoint for this message
        const latestCheckpoint = messageCheckpoints[0]
        try {
          await revertToCheckpoint(latestCheckpoint.id)
          setShowRestoreConfirmation(false)
        } catch (error) {
          console.error('Failed to revert to checkpoint:', error)
          setShowRestoreConfirmation(false)
        }
      }
    }

    const handleCancelRevert = () => {
      setShowRestoreConfirmation(false)
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

    // Custom components for react-markdown with current styling - memoized to prevent re-renders
    const markdownComponents = useMemo(
      () => ({
        // Paragraph
        p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
          <p className='mb-1 font-geist-sans text-base text-gray-800 leading-relaxed last:mb-0 dark:text-gray-200'>
            {children}
          </p>
        ),

        // Headings
        h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
          <h1 className='mt-10 mb-5 font-geist-sans font-semibold text-2xl text-gray-900 dark:text-gray-100'>
            {children}
          </h1>
        ),
        h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
          <h2 className='mt-8 mb-4 font-geist-sans font-semibold text-gray-900 text-xl dark:text-gray-100'>
            {children}
          </h2>
        ),
        h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
          <h3 className='mt-7 mb-3 font-geist-sans font-semibold text-gray-900 text-lg dark:text-gray-100'>
            {children}
          </h3>
        ),
        h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
          <h4 className='mt-5 mb-2 font-geist-sans font-semibold text-base text-gray-900 dark:text-gray-100'>
            {children}
          </h4>
        ),

        // Lists
        ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
          <ul
            className='mt-1 mb-1 space-y-1 pl-6 font-geist-sans text-gray-800 dark:text-gray-200'
            style={{ listStyleType: 'disc' }}
          >
            {children}
          </ul>
        ),
        ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
          <ol
            className='mt-1 mb-1 space-y-1 pl-6 font-geist-sans text-gray-800 dark:text-gray-200'
            style={{ listStyleType: 'decimal' }}
          >
            {children}
          </ol>
        ),
        li: ({
          children,
          ordered,
          ...props
        }: React.LiHTMLAttributes<HTMLLIElement> & { ordered?: boolean }) => (
          <li
            className='font-geist-sans text-gray-800 dark:text-gray-200'
            style={{ display: 'list-item' }}
          >
            {children}
          </li>
        ),

        // Code blocks
        pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
          let codeProps: React.HTMLAttributes<HTMLElement> = {}
          let codeContent: React.ReactNode = children
          let language = 'code'

          if (
            React.isValidElement<{ className?: string; children?: React.ReactNode }>(children) &&
            children.type === 'code'
          ) {
            const childElement = children as React.ReactElement<{
              className?: string
              children?: React.ReactNode
            }>
            codeProps = { className: childElement.props.className }
            codeContent = childElement.props.children
            language = childElement.props.className?.replace('language-', '') || 'code'
          }

          return (
            <div className='my-6 rounded-md bg-gray-900 text-sm dark:bg-black'>
              <div className='flex items-center justify-between border-gray-700 border-b px-4 py-1.5 dark:border-gray-800'>
                <span className='font-geist-sans text-gray-400 text-xs'>{language}</span>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-4 w-4 p-0 opacity-70 hover:opacity-100'
                  onClick={() => {
                    if (typeof codeContent === 'string') {
                      navigator.clipboard.writeText(codeContent)
                    }
                  }}
                >
                  <Copy className='h-3 w-3 text-gray-400' />
                </Button>
              </div>
              <pre className='overflow-x-auto p-4 font-mono text-gray-100 text-sm leading-relaxed'>
                {codeContent}
              </pre>
            </div>
          )
        },

        // Inline code
        code: ({
          inline,
          className,
          children,
          ...props
        }: React.HTMLAttributes<HTMLElement> & { className?: string; inline?: boolean }) => {
          if (inline) {
            return (
              <code
                className='rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.9em] text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                {...props}
              >
                {children}
              </code>
            )
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        },

        // Blockquotes
        blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
          <blockquote className='my-4 border-gray-300 border-l-4 py-1 pl-4 font-geist-sans text-gray-700 italic dark:border-gray-600 dark:text-gray-300'>
            {children}
          </blockquote>
        ),

        // Horizontal rule
        hr: () => <hr className='my-8 border-gray-500/[.07] border-t dark:border-gray-400/[.07]' />,

        // Links
        a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
          <LinkWithPreview href={href || '#'} {...props}>
            {children}
          </LinkWithPreview>
        ),

        // Tables
        table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
          <div className='my-4 w-full overflow-x-auto'>
            <table className='min-w-full table-auto border border-gray-300 font-geist-sans text-sm dark:border-gray-700'>
              {children}
            </table>
          </div>
        ),
        thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
          <thead className='bg-gray-100 text-left dark:bg-gray-800'>{children}</thead>
        ),
        tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
          <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>{children}</tbody>
        ),
        tr: ({ children }: React.HTMLAttributes<HTMLTableRowElement>) => (
          <tr className='border-gray-200 border-b transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/60'>
            {children}
          </tr>
        ),
        th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
          <th className='border-gray-300 border-r px-4 py-2 font-medium text-gray-700 last:border-r-0 dark:border-gray-700 dark:text-gray-300'>
            {children}
          </th>
        ),
        td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
          <td className='break-words border-gray-300 border-r px-4 py-2 text-gray-800 last:border-r-0 dark:border-gray-700 dark:text-gray-200'>
            {children}
          </td>
        ),

        // Images
        img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
          <img
            src={src}
            alt={alt || 'Image'}
            className='my-3 h-auto max-w-full rounded-md'
            {...props}
          />
        ),
      }),
      []
    )

    // Memoize content blocks to avoid re-rendering unchanged blocks
    const memoizedContentBlocks = useMemo(() => {
      if (!message.contentBlocks || message.contentBlocks.length === 0) {
        return null
      }

      return message.contentBlocks.map((block, index) => {
        if (block.type === 'text') {
          const isLastTextBlock =
            index === message.contentBlocks!.length - 1 && block.type === 'text'
          // Clean content for this text block
          const cleanBlockContent = block.content.replace(/\n{3,}/g, '\n\n')

          // Use smooth streaming for the last text block if we're streaming
          const shouldUseSmoothing = isStreaming && isLastTextBlock

          return (
            <div
              key={`text-${index}-${block.timestamp || index}`}
              className='w-full transition-opacity duration-200 ease-in-out'
              style={{
                opacity: cleanBlockContent.length > 0 ? 1 : 0.7,
                transform: shouldUseSmoothing ? 'translateY(0)' : undefined,
                transition: shouldUseSmoothing
                  ? 'transform 0.1s ease-out, opacity 0.2s ease-in-out'
                  : 'opacity 0.2s ease-in-out',
              }}
            >
              {shouldUseSmoothing ? (
                <SmoothStreamingText
                  content={cleanBlockContent}
                  isStreaming={isStreaming}
                  markdownComponents={markdownComponents}
                />
              ) : (
                <div className='space-y-4 break-words font-geist-sans text-[#0D0D0D] text-base leading-relaxed dark:text-gray-100'>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {cleanBlockContent}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )
        }
        if (block.type === 'tool_call') {
          return (
            <div
              key={`tool-${block.toolCall.id}`}
              className='transition-opacity duration-300 ease-in-out'
              style={{ opacity: 1 }}
            >
              <InlineToolCall toolCall={block.toolCall} />
            </div>
          )
        }
        return null
      })
    }, [message.contentBlocks, isStreaming, markdownComponents])

    if (isUser) {
      return (
        <div className='w-full py-2'>
          <div className='flex justify-end'>
            <div className='max-w-[80%]'>
              <div
                className='rounded-[10px] px-3 py-2'
                style={{ backgroundColor: 'rgba(128, 47, 255, 0.08)' }}
              >
                <div className='whitespace-pre-wrap break-words font-normal text-base text-foreground leading-relaxed'>
                  <WordWrap text={message.content} />
                </div>
              </div>
              {hasCheckpoints && (
                <div className='mt-1 flex justify-end'>
                  {showRestoreConfirmation ? (
                    <div className='flex items-center gap-2'>
                      <span className='text-muted-foreground text-xs'>Restore?</span>
                      <button
                        onClick={handleConfirmRevert}
                        disabled={isRevertingCheckpoint}
                        className='text-muted-foreground text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                        title='Confirm restore'
                      >
                        {isRevertingCheckpoint ? (
                          <Loader2 className='h-3 w-3 animate-spin' />
                        ) : (
                          <Check className='h-3 w-3' />
                        )}
                      </button>
                      <button
                        onClick={handleCancelRevert}
                        disabled={isRevertingCheckpoint}
                        className='text-muted-foreground text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                        title='Cancel restore'
                      >
                        <X className='h-3 w-3' />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleRevertToCheckpoint}
                      disabled={isRevertingCheckpoint}
                      className='flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                      title='Restore workflow to this checkpoint state'
                    >
                      <RotateCcw className='h-3 w-3' />
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )
    }

    if (isAssistant) {
      return (
        <div className='w-full py-2 pl-[2px]'>
          <div className='space-y-2 transition-all duration-200 ease-in-out'>
            {/* Content blocks in chronological order */}
            {memoizedContentBlocks}

            {/* Show streaming indicator if streaming but no text content yet after tool calls */}
            {isStreaming &&
              !message.content &&
              message.contentBlocks?.every((block) => block.type === 'tool_call') && (
                <StreamingIndicator />
              )}

            {/* Streaming indicator when no content yet */}
            {!cleanTextContent && !message.contentBlocks?.length && isStreaming && (
              <StreamingIndicator />
            )}

            {/* Action buttons for completed messages */}
            {!isStreaming && cleanTextContent && (
              <div className='flex items-center gap-2'>
                <button
                  onClick={handleCopyContent}
                  className='text-muted-foreground transition-colors hover:bg-muted'
                  title='Copy'
                >
                  {showCopySuccess ? (
                    <Check className='h-3 w-3' strokeWidth={2} />
                  ) : (
                    <Clipboard className='h-3 w-3' strokeWidth={2} />
                  )}
                </button>
                <button
                  onClick={handleUpvote}
                  className='text-muted-foreground transition-colors hover:bg-muted'
                  title='Upvote'
                >
                  {showUpvoteSuccess ? (
                    <Check className='h-3 w-3' strokeWidth={2} />
                  ) : (
                    <ThumbsUp className='h-3 w-3' strokeWidth={2} />
                  )}
                </button>
                <button
                  onClick={handleDownvote}
                  className='text-muted-foreground transition-colors hover:bg-muted'
                  title='Downvote'
                >
                  {showDownvoteSuccess ? (
                    <Check className='h-3 w-3' strokeWidth={2} />
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
  },
  (prevProps, nextProps) => {
    // Custom comparison function for better streaming performance
    const prevMessage = prevProps.message
    const nextMessage = nextProps.message

    // If message IDs are different, always re-render
    if (prevMessage.id !== nextMessage.id) {
      return false
    }

    // If streaming state changed, re-render
    if (prevProps.isStreaming !== nextProps.isStreaming) {
      return false
    }

    // For streaming messages, check if content actually changed
    if (nextProps.isStreaming) {
      // Compare contentBlocks length and lastUpdated for streaming messages
      const prevBlocks = prevMessage.contentBlocks || []
      const nextBlocks = nextMessage.contentBlocks || []

      if (prevBlocks.length !== nextBlocks.length) {
        return false // Content blocks changed
      }

      // Check if any text content changed in the last block
      if (nextBlocks.length > 0) {
        const prevLastBlock = prevBlocks[prevBlocks.length - 1]
        const nextLastBlock = nextBlocks[nextBlocks.length - 1]

        if (prevLastBlock?.type === 'text' && nextLastBlock?.type === 'text') {
          if (prevLastBlock.content !== nextLastBlock.content) {
            return false // Text content changed
          }
        }
      }

      // Check if tool calls changed
      const prevToolCalls = prevMessage.toolCalls || []
      const nextToolCalls = nextMessage.toolCalls || []

      if (prevToolCalls.length !== nextToolCalls.length) {
        return false // Tool calls count changed
      }

      // Check if any tool call state changed
      for (let i = 0; i < nextToolCalls.length; i++) {
        if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) {
          return false // Tool call state changed
        }
      }

      // If we reach here, nothing meaningful changed during streaming
      return true
    }

    // For non-streaming messages, do a deeper comparison including tool call states
    if (
      prevMessage.content !== nextMessage.content ||
      prevMessage.role !== nextMessage.role ||
      (prevMessage.toolCalls?.length || 0) !== (nextMessage.toolCalls?.length || 0) ||
      (prevMessage.contentBlocks?.length || 0) !== (nextMessage.contentBlocks?.length || 0)
    ) {
      return false
    }

    // Check tool call states for non-streaming messages too
    const prevToolCalls = prevMessage.toolCalls || []
    const nextToolCalls = nextMessage.toolCalls || []
    for (let i = 0; i < nextToolCalls.length; i++) {
      if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) {
        return false // Tool call state changed
      }
    }

    // Check contentBlocks tool call states
    const prevContentBlocks = prevMessage.contentBlocks || []
    const nextContentBlocks = nextMessage.contentBlocks || []
    for (let i = 0; i < nextContentBlocks.length; i++) {
      const prevBlock = prevContentBlocks[i]
      const nextBlock = nextContentBlocks[i]
      if (
        prevBlock?.type === 'tool_call' &&
        nextBlock?.type === 'tool_call' &&
        prevBlock.toolCall?.state !== nextBlock.toolCall?.state
      ) {
        return false // ContentBlock tool call state changed
      }
    }

    return true
  }
)

ProfessionalMessage.displayName = 'ProfessionalMessage'

export { ProfessionalMessage }
