'use client'

import { type FC, memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle,
  Clipboard,
  Code,
  Copy,
  Database,
  Edit,
  Eye,
  FileText,
  Globe,
  Lightbulb,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  COPILOT_TOOL_DISPLAY_NAMES,
  COPILOT_TOOL_ERROR_NAMES,
  COPILOT_TOOL_PAST_TENSE,
} from '@/stores/constants'
import CopilotMarkdownRenderer from '../markdown-renderer'
import { COPILOT_TOOL_IDS } from '@/stores/copilot/constants'

import { useCopilotStore } from '@/stores/copilot/store'
import type { CopilotMessage } from '@/stores/copilot/types'
import { InlineToolCall } from '../../lib/tools/inline-tool-call'

interface ProfessionalMessageProps {
  message: CopilotMessage
  isStreaming?: boolean
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
}

const SmoothStreamingText = memo(
  ({ content, isStreaming }: SmoothStreamingTextProps) => {
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

        // Calculate where animation should be based on elapsed time
        const CHARS_PER_SECOND = 333 // ~3ms per character
        const elapsedTime = Date.now() - streamingStartTimeRef.current
        const expectedPosition = Math.floor((elapsedTime / 1000) * CHARS_PER_SECOND)
        
        // Show content up to where it should be, but don't exceed available content
        const targetPosition = Math.min(expectedPosition, content.length)
        
        if (targetPosition > indexRef.current) {
          // We need to catch up - show content immediately up to target position
          setDisplayedContent(content.slice(0, targetPosition))
          indexRef.current = targetPosition
        }

        // Continue animation if there's more content to show
        if (indexRef.current < content.length) {
          const animateText = () => {
            const currentContent = contentRef.current
            const currentIndex = indexRef.current

            if (currentIndex < currentContent.length) {
              // Add characters in small chunks for smoother appearance
              const chunkSize = Math.min(3, currentContent.length - currentIndex)
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
        <CopilotMarkdownRenderer content={displayedContent} />
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

    // Remove markdownComponents as we'll use the new CopilotMarkdownRenderer

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
                />
              ) : (
                <CopilotMarkdownRenderer content={cleanBlockContent} />
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
    }, [message.contentBlocks, isStreaming])

    if (isUser) {
      return (
        <div className='w-full py-2'>
          <div className='flex justify-end'>
            <div className='max-w-[80%]'>
              <div
                className='rounded-[10px] px-3 py-2'
                style={{ backgroundColor: 'rgba(128, 47, 255, 0.08)' }}
              >
                <div className='whitespace-pre-wrap break-words font-normal text-foreground text-base leading-relaxed'>
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
