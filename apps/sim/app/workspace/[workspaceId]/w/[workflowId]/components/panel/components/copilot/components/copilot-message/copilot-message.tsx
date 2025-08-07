'use client'

import { type FC, memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Clipboard,
  FileText,
  Image,
  Loader2,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react'
import { InlineToolCall } from '@/lib/copilot/tools/inline-tool-call'
import { createLogger } from '@/lib/logs/console/logger'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { useCopilotStore } from '@/stores/copilot/store'
import type { CopilotMessage as CopilotMessageType } from '@/stores/copilot/types'
import CopilotMarkdownRenderer from './components/markdown-renderer'

const logger = createLogger('CopilotMessage')

interface CopilotMessageProps {
  message: CopilotMessageType
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

// File attachment display component
interface FileAttachmentDisplayProps {
  fileAttachments: any[]
}

const FileAttachmentDisplay = memo(({ fileAttachments }: FileAttachmentDisplayProps) => {
  // Cache for file URLs to avoid re-fetching on every render
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
  }

  const getFileIcon = (mediaType: string) => {
    if (mediaType.startsWith('image/')) {
      return <Image className='h-5 w-5 text-muted-foreground' />
    }
    if (mediaType.includes('pdf')) {
      return <FileText className='h-5 w-5 text-red-500' />
    }
    if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
      return <FileText className='h-5 w-5 text-blue-500' />
    }
    return <FileText className='h-5 w-5 text-muted-foreground' />
  }

  const getFileUrl = (file: any) => {
    const cacheKey = file.s3_key
    if (fileUrls[cacheKey]) {
      return fileUrls[cacheKey]
    }

    // Generate URL only once and cache it
    const url = `/api/files/serve/s3/${encodeURIComponent(file.s3_key)}?bucket=copilot`
    setFileUrls((prev) => ({ ...prev, [cacheKey]: url }))
    return url
  }

  const handleFileClick = (file: any) => {
    // Use cached URL or generate it
    const serveUrl = getFileUrl(file)

    // Open the file in a new tab
    window.open(serveUrl, '_blank')
  }

  const isImageFile = (mediaType: string) => {
    return mediaType.startsWith('image/')
  }

  return (
    <>
      {fileAttachments.map((file) => (
        <div
          key={file.id}
          className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-muted/40'
          onClick={() => handleFileClick(file)}
          title={`${file.filename} (${formatFileSize(file.size)})`}
        >
          {isImageFile(file.media_type) ? (
            // For images, show actual thumbnail
            <img
              src={getFileUrl(file)}
              alt={file.filename}
              className='h-full w-full object-cover'
              onError={(e) => {
                // If image fails to load, replace with icon
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                const parent = target.parentElement
                if (parent) {
                  const iconContainer = document.createElement('div')
                  iconContainer.className =
                    'flex items-center justify-center w-full h-full bg-background/50'
                  iconContainer.innerHTML =
                    '<svg class="h-5 w-5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
                  parent.appendChild(iconContainer)
                }
              }}
            />
          ) : (
            // For other files, show icon centered
            <div className='flex h-full w-full items-center justify-center bg-background/50'>
              {getFileIcon(file.media_type)}
            </div>
          )}

          {/* Hover overlay effect */}
          <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
        </div>
      ))}
    </>
  )
})

FileAttachmentDisplay.displayName = 'FileAttachmentDisplay'

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
      <div className='relative max-w-full overflow-hidden' style={{ minHeight: '1.25rem' }}>
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

const CopilotMessage: FC<CopilotMessageProps> = memo(
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
      currentChat,
      messages,
      workflowId,
    } = useCopilotStore()

    // Get preview store for accessing workflow YAML after rejection
    const { getPreviewByToolCall, getLatestPendingPreview } = usePreviewStore()

    // Import COPILOT_TOOL_IDS - placing it here since it's needed in multiple functions
    const WORKFLOW_TOOL_NAMES = ['build_workflow', 'edit_workflow']

    // Get checkpoints for this message if it's a user message
    const messageCheckpoints = isUser ? allMessageCheckpoints[message.id] || [] : []
    const hasCheckpoints = messageCheckpoints.length > 0

    const handleCopyContent = () => {
      // Copy clean text content
      navigator.clipboard.writeText(message.content)
      setShowCopySuccess(true)
    }

    // Helper function to get the full assistant response content
    const getFullAssistantContent = (message: CopilotMessageType) => {
      // First try the direct content
      if (message.content?.trim()) {
        return message.content
      }

      // If no direct content, build from content blocks
      if (message.contentBlocks && message.contentBlocks.length > 0) {
        return message.contentBlocks
          .filter((block) => block.type === 'text')
          .map((block) => block.content)
          .join('')
      }

      return message.content || ''
    }

    // Helper function to find the last user query before this assistant message
    const getLastUserQuery = () => {
      const messageIndex = messages.findIndex((msg) => msg.id === message.id)
      if (messageIndex === -1) return null

      // Look backwards from this message to find the last user message
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          return messages[i].content
        }
      }
      return null
    }

    // Helper function to extract workflow YAML from workflow tool calls
    const getWorkflowYaml = () => {
      // Step 1: Check both toolCalls array and contentBlocks for workflow tools
      const allToolCalls = [
        ...(message.toolCalls || []),
        ...(message.contentBlocks || [])
          .filter((block) => block.type === 'tool_call')
          .map((block) => (block as any).toolCall),
      ]

      // Find workflow tools (build_workflow or edit_workflow)
      const workflowTools = allToolCalls.filter((toolCall) =>
        WORKFLOW_TOOL_NAMES.includes(toolCall?.name)
      )

      // Extract YAML content from workflow tools in the current message
      for (const toolCall of workflowTools) {
        // Try various locations where YAML content might be stored
        const yamlContent =
          toolCall.result?.yamlContent ||
          toolCall.result?.data?.yamlContent ||
          toolCall.input?.yamlContent ||
          toolCall.input?.data?.yamlContent

        if (yamlContent && typeof yamlContent === 'string' && yamlContent.trim()) {
          return yamlContent
        }
      }

      // Step 2: Check copilot store's preview YAML (set when workflow tools execute)
      if (currentChat?.previewYaml?.trim()) {
        return currentChat.previewYaml
      }

      // Step 3: Check preview store for recent workflow tool calls from this message
      for (const toolCall of workflowTools) {
        if (toolCall.id) {
          const preview = getPreviewByToolCall(toolCall.id)
          if (preview?.yamlContent?.trim()) {
            return preview.yamlContent
          }
        }
      }

      // Step 4: If this message contains workflow tools but no YAML found yet,
      // try to get the latest pending preview for this workflow (fallback)
      if (workflowTools.length > 0 && workflowId) {
        const latestPreview = getLatestPendingPreview(workflowId, currentChat?.id)
        if (latestPreview?.yamlContent?.trim()) {
          return latestPreview.yamlContent
        }
      }

      return null
    }

    // Function to submit feedback
    const submitFeedback = async (isPositive: boolean) => {
      // Ensure we have a chat ID
      if (!currentChat?.id) {
        logger.error('No current chat ID available for feedback submission')
        return
      }

      const userQuery = getLastUserQuery()
      if (!userQuery) {
        logger.error('No user query found for feedback submission')
        return
      }

      const agentResponse = getFullAssistantContent(message)
      if (!agentResponse.trim()) {
        logger.error('No agent response content available for feedback submission')
        return
      }

      // Get workflow YAML if this message contains workflow tools
      const workflowYaml = getWorkflowYaml()

      try {
        const requestBody: any = {
          chatId: currentChat.id,
          userQuery,
          agentResponse,
          isPositiveFeedback: isPositive,
        }

        // Only include workflowYaml if it exists
        if (workflowYaml) {
          requestBody.workflowYaml = workflowYaml
        }

        const response = await fetch('/api/copilot/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          throw new Error(`Failed to submit feedback: ${response.statusText}`)
        }

        const result = await response.json()
      } catch (error) {
        logger.error('Error submitting feedback:', error)
      }
    }

    const handleUpvote = async () => {
      // Reset downvote if it was active
      setShowDownvoteSuccess(false)
      setShowUpvoteSuccess(true)

      // Submit positive feedback
      await submitFeedback(true)
    }

    const handleDownvote = async () => {
      // Reset upvote if it was active
      setShowUpvoteSuccess(false)
      setShowDownvoteSuccess(true)

      // Submit negative feedback
      await submitFeedback(false)
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
          logger.error('Failed to revert to checkpoint:', error)
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

    // Get clean text content with double newline parsing
    const cleanTextContent = useMemo(() => {
      if (!message.content) return ''

      // Parse out excessive newlines (more than 2 consecutive newlines)
      return message.content.replace(/\n{3,}/g, '\n\n')
    }, [message.content])

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
              className='w-full max-w-full overflow-hidden transition-opacity duration-200 ease-in-out'
              style={{
                opacity: cleanBlockContent.length > 0 ? 1 : 0.7,
                transform: shouldUseSmoothing ? 'translateY(0)' : undefined,
                transition: shouldUseSmoothing
                  ? 'transform 0.1s ease-out, opacity 0.2s ease-in-out'
                  : 'opacity 0.2s ease-in-out',
              }}
            >
              {shouldUseSmoothing ? (
                <SmoothStreamingText content={cleanBlockContent} isStreaming={isStreaming} />
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
          {/* File attachments displayed above the message, completely separate from message box width */}
          {message.fileAttachments && message.fileAttachments.length > 0 && (
            <div className='mb-1 flex justify-end'>
              <div className='flex flex-wrap gap-1.5'>
                <FileAttachmentDisplay fileAttachments={message.fileAttachments} />
              </div>
            </div>
          )}

          <div className='flex justify-end'>
            <div className='max-w-[80%]'>
              {/* Message content in purple box */}
              <div
                className='rounded-[10px] px-3 py-2'
                style={{ backgroundColor: 'rgba(128, 47, 255, 0.08)' }}
              >
                <div className='whitespace-pre-wrap break-words font-normal text-base text-foreground leading-relaxed'>
                  <WordWrap text={message.content} />
                </div>
              </div>

              {/* Checkpoints below message */}
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
        <div className='w-full max-w-full overflow-hidden py-2 pl-[2px]'>
          <div className='max-w-full space-y-2 transition-all duration-200 ease-in-out'>
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

CopilotMessage.displayName = 'CopilotMessage'

export { CopilotMessage }
