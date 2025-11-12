'use client'

import { type FC, memo, useMemo, useState } from 'react'
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { InlineToolCall } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components'
import {
  FileAttachmentDisplay,
  SmoothStreamingText,
  StreamingIndicator,
  ThinkingBlock,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/copilot-message/components'
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/copilot-message/components/markdown-renderer'
import { UserInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/user-input/user-input'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import type { CopilotMessage as CopilotMessageType } from '@/stores/panel-new/copilot/types'
import {
  useCheckpointManagement,
  useMessageEditing,
  useMessageFeedback,
  useSuccessTimers,
} from './hooks'

const logger = createLogger('CopilotMessage')

/**
 * Props for the CopilotMessage component
 */
interface CopilotMessageProps {
  /** Message object containing content and metadata */
  message: CopilotMessageType
  /** Whether the message is currently streaming */
  isStreaming?: boolean
  /** Width of the panel in pixels */
  panelWidth?: number
  /** Whether the message should appear dimmed */
  isDimmed?: boolean
  /** Number of checkpoints for this message */
  checkpointCount?: number
  /** Callback when edit mode changes */
  onEditModeChange?: (isEditing: boolean, cancelCallback?: () => void) => void
  /** Callback when revert mode changes */
  onRevertModeChange?: (isReverting: boolean) => void
}

/**
 * CopilotMessage component displays individual chat messages
 * Handles both user and assistant messages with different rendering and interactions
 * Supports editing, checkpoints, feedback, and file attachments
 *
 * @param props - Component props
 * @returns Message component with appropriate role-based rendering
 */
const CopilotMessage: FC<CopilotMessageProps> = memo(
  ({
    message,
    isStreaming,
    panelWidth = 308,
    isDimmed = false,
    checkpointCount = 0,
    onEditModeChange,
    onRevertModeChange,
  }) => {
    const isUser = message.role === 'user'
    const isAssistant = message.role === 'assistant'

    // Store state
    const {
      messageCheckpoints: allMessageCheckpoints,
      messages,
      isSendingMessage,
      abortMessage,
      mode,
      setMode,
      isAborting,
    } = useCopilotStore()

    // Get checkpoints for this message if it's a user message
    const messageCheckpoints = isUser ? allMessageCheckpoints[message.id] || [] : []
    const hasCheckpoints = messageCheckpoints.length > 0 && messageCheckpoints.some((cp) => cp?.id)

    // Check if this is the last user message (for showing abort button)
    const isLastUserMessage = useMemo(() => {
      if (!isUser) return false
      const userMessages = messages.filter((m) => m.role === 'user')
      return userMessages.length > 0 && userMessages[userMessages.length - 1]?.id === message.id
    }, [isUser, messages, message.id])

    // UI state
    const [isHoveringMessage, setIsHoveringMessage] = useState(false)

    // Success timers hook
    const {
      showCopySuccess,
      showUpvoteSuccess,
      showDownvoteSuccess,
      handleCopy,
      setShowUpvoteSuccess,
      setShowDownvoteSuccess,
    } = useSuccessTimers()

    // Message feedback hook
    const { handleUpvote, handleDownvote } = useMessageFeedback(message, messages, {
      setShowUpvoteSuccess,
      setShowDownvoteSuccess,
    })

    // Checkpoint management hook
    const {
      showRestoreConfirmation,
      showCheckpointDiscardModal,
      pendingEditRef,
      setShowCheckpointDiscardModal,
      handleRevertToCheckpoint,
      handleConfirmRevert,
      handleCancelRevert,
      handleCancelCheckpointDiscard,
      handleContinueWithoutRevert,
      handleContinueAndRevert,
    } = useCheckpointManagement(
      message,
      messages,
      messageCheckpoints,
      onRevertModeChange,
      onEditModeChange
    )

    // Message editing hook
    const {
      isEditMode,
      isExpanded,
      editedContent,
      needsExpansion,
      editContainerRef,
      messageContentRef,
      userInputRef,
      setEditedContent,
      handleCancelEdit,
      handleMessageClick,
      handleSubmitEdit,
    } = useMessageEditing({
      message,
      messages,
      isLastUserMessage,
      hasCheckpoints,
      onEditModeChange: (isEditing) => {
        onEditModeChange?.(isEditing, handleCancelEdit)
      },
      disableDocumentClickOutside: true,
      showCheckpointDiscardModal,
      setShowCheckpointDiscardModal,
      pendingEditRef,
    })

    /**
     * Handles copying message content to clipboard
     * Uses the success timer hook to show feedback
     */
    const handleCopyContent = () => {
      handleCopy(message.content)
    }

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
              className={`w-full max-w-full overflow-hidden transition-opacity duration-200 ease-in-out ${
                cleanBlockContent.length > 0 ? 'opacity-100' : 'opacity-70'
              } ${shouldUseSmoothing ? 'translate-y-0 transition-transform duration-100 ease-out' : ''}`}
            >
              {shouldUseSmoothing ? (
                <SmoothStreamingText content={cleanBlockContent} isStreaming={isStreaming} />
              ) : (
                <CopilotMarkdownRenderer content={cleanBlockContent} />
              )}
            </div>
          )
        }
        if (block.type === 'thinking') {
          const isLastBlock = index === message.contentBlocks!.length - 1
          // Consider the thinking block streaming if the overall message is streaming
          // and the block has not been finalized with a duration yet. This avoids
          // freezing the timer when new blocks are appended after the thinking block.
          const isStreamingThinking = isStreaming && (block as any).duration == null

          return (
            <div key={`thinking-${index}-${block.timestamp || index}`} className='w-full'>
              <ThinkingBlock
                content={block.content}
                isStreaming={isStreamingThinking}
                duration={block.duration}
                startTime={block.startTime}
              />
            </div>
          )
        }
        if (block.type === 'tool_call') {
          return (
            <div
              key={`tool-${block.toolCall.id}`}
              className='opacity-100 transition-opacity duration-300 ease-in-out'
            >
              <InlineToolCall toolCallId={block.toolCall.id} toolCall={block.toolCall} />
            </div>
          )
        }
        return null
      })
    }, [message.contentBlocks, isStreaming])

    if (isUser) {
      return (
        <div
          className={`w-full max-w-full overflow-hidden transition-opacity duration-200 [max-width:var(--panel-max-width)] ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
          style={{ '--panel-max-width': `${panelWidth - 16}px` } as React.CSSProperties}
        >
          {isEditMode ? (
            <div
              ref={editContainerRef}
              data-edit-container
              data-message-id={message.id}
              className='relative w-full'
            >
              <UserInput
                ref={userInputRef}
                onSubmit={handleSubmitEdit}
                onAbort={() => {
                  if (isSendingMessage && isLastUserMessage) {
                    abortMessage()
                  }
                }}
                isLoading={isSendingMessage && isLastUserMessage}
                isAborting={isAborting}
                disabled={showCheckpointDiscardModal}
                value={editedContent}
                onChange={setEditedContent}
                placeholder='Edit your message...'
                mode={mode}
                onModeChange={setMode}
                panelWidth={panelWidth}
                clearOnSubmit={false}
              />

              {/* Inline Checkpoint Discard Confirmation - shown below input in edit mode */}
              {showCheckpointDiscardModal && (
                <div className='mt-[8px] rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] p-[10px] dark:border-[var(--surface-11)] dark:bg-[var(--surface-9)]'>
                  <p className='mb-[8px] text-[var(--text-primary)] text-sm'>
                    Continue from a previous message?
                  </p>
                  <div className='flex gap-[6px]'>
                    <Button
                      onClick={handleCancelCheckpointDiscard}
                      variant='default'
                      className='flex flex-1 items-center justify-center gap-[6px] px-[8px] py-[4px] text-xs'
                    >
                      <span>Cancel</span>
                      <span className='text-[10px] text-[var(--text-muted)]'>(Esc)</span>
                    </Button>
                    <Button
                      onClick={handleContinueAndRevert}
                      variant='outline'
                      className='flex-1 px-[8px] py-[4px] text-xs'
                    >
                      Revert
                    </Button>
                    <Button
                      onClick={handleContinueWithoutRevert}
                      variant='outline'
                      className='flex-1 px-[8px] py-[4px] text-xs'
                    >
                      Continue
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className='w-full'>
              {/* File attachments displayed above the message box */}
              {message.fileAttachments && message.fileAttachments.length > 0 && (
                <div className='mb-1.5 flex flex-wrap gap-1.5'>
                  <FileAttachmentDisplay fileAttachments={message.fileAttachments} />
                </div>
              )}

              {/* Message box - styled like input, clickable to edit */}
              <div
                data-message-box
                data-message-id={message.id}
                onClick={handleMessageClick}
                onMouseEnter={() => setIsHoveringMessage(true)}
                onMouseLeave={() => setIsHoveringMessage(false)}
                className='group relative w-full cursor-pointer rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[6px] py-[6px] transition-all duration-200 hover:border-[var(--surface-14)] hover:bg-[var(--surface-9)] dark:border-[var(--surface-11)] dark:bg-[var(--surface-9)] dark:hover:border-[var(--surface-13)] dark:hover:bg-[var(--surface-11)]'
              >
                <div
                  ref={messageContentRef}
                  className={`relative whitespace-pre-wrap break-words px-[2px] py-1 font-medium font-sans text-[#0D0D0D] text-sm leading-[1.25rem] dark:text-gray-100 ${isSendingMessage && isLastUserMessage && isHoveringMessage ? 'pr-7' : ''} ${!isExpanded && needsExpansion ? 'max-h-[60px] overflow-hidden' : 'overflow-visible'}`}
                >
                  {(() => {
                    const text = message.content || ''
                    const contexts: any[] = Array.isArray((message as any).contexts)
                      ? ((message as any).contexts as any[])
                      : []
                    const labels = contexts
                      .filter((c) => c?.kind !== 'current_workflow')
                      .map((c) => c?.label)
                      .filter(Boolean) as string[]
                    if (!labels.length) return text

                    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    const pattern = new RegExp(`@(${labels.map(escapeRegex).join('|')})`, 'g')

                    const nodes: React.ReactNode[] = []
                    let lastIndex = 0
                    let match: RegExpExecArray | null
                    while ((match = pattern.exec(text)) !== null) {
                      const i = match.index
                      const before = text.slice(lastIndex, i)
                      if (before) nodes.push(before)
                      const mention = match[0]
                      nodes.push(
                        <span
                          key={`mention-${i}-${lastIndex}`}
                          className='rounded-[6px] bg-[rgba(142,76,251,0.65)]'
                        >
                          {mention}
                        </span>
                      )
                      lastIndex = i + mention.length
                    }
                    const tail = text.slice(lastIndex)
                    if (tail) nodes.push(tail)
                    return nodes
                  })()}
                </div>

                {/* Gradient fade when truncated - applies to entire message box */}
                {!isExpanded && needsExpansion && (
                  <div className='pointer-events-none absolute right-0 bottom-0 left-0 h-6 bg-gradient-to-t from-0% from-[var(--surface-6)] via-40% via-[var(--surface-6)]/70 to-100% to-transparent group-hover:from-[var(--surface-9)] group-hover:via-[var(--surface-9)]/70 dark:from-[var(--surface-9)] dark:via-[var(--surface-9)]/70 dark:group-hover:from-[var(--surface-11)] dark:group-hover:via-[var(--surface-11)]/70' />
                )}

                {/* Abort button when hovering and response is generating (only on last user message) */}
                {isSendingMessage && isHoveringMessage && isLastUserMessage && (
                  <div className='pointer-events-auto absolute right-[6px] bottom-[6px]'>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        abortMessage()
                      }}
                      className='h-[20px] w-[20px] rounded-full bg-[#C0C0C0] p-0 transition-colors hover:bg-[#D0D0D0] dark:bg-[#C0C0C0] dark:hover:bg-[#D0D0D0]'
                      title='Stop generation'
                    >
                      <svg
                        className='block h-[13px] w-[13px]'
                        viewBox='0 0 24 24'
                        fill='black'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
                      </svg>
                    </Button>
                  </div>
                )}

                {/* Revert button on hover (only when has checkpoints and not generating) */}
                {!isSendingMessage && hasCheckpoints && isHoveringMessage && (
                  <div className='pointer-events-auto absolute right-[6px] bottom-[6px]'>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRevertToCheckpoint()
                      }}
                      variant='ghost'
                      className='h-[22px] w-[22px] rounded-full p-0'
                      title='Revert to checkpoint'
                    >
                      <RotateCcw className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inline Restore Checkpoint Confirmation */}
          {showRestoreConfirmation && (
            <div className='mt-[8px] rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] p-[10px] dark:border-[var(--surface-11)] dark:bg-[var(--surface-9)]'>
              <p className='mb-[8px] text-[var(--text-primary)] text-sm'>
                Revert to checkpoint? This will restore your workflow to the state saved at this
                checkpoint.{' '}
                <span className='font-medium text-[var(--text-error)]'>
                  This action cannot be undone.
                </span>
              </p>
              <div className='flex gap-[6px]'>
                <Button
                  onClick={handleCancelRevert}
                  variant='default'
                  className='flex flex-1 items-center justify-center gap-[6px] px-[8px] py-[4px] text-xs'
                >
                  <span>Cancel</span>
                  <span className='text-[10px] text-[var(--text-muted)]'>(Esc)</span>
                </Button>
                <Button
                  onClick={handleConfirmRevert}
                  variant='outline'
                  className='flex-1 px-[8px] py-[4px] text-xs'
                >
                  Revert
                </Button>
              </div>
            </div>
          )}
        </div>
      )
    }

    if (isAssistant) {
      return (
        <div
          className={`w-full max-w-full overflow-hidden transition-opacity duration-200 [max-width:var(--panel-max-width)] ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
          style={{ '--panel-max-width': `${panelWidth - 16}px` } as React.CSSProperties}
        >
          <div className='max-w-full space-y-1.5 px-[2px] transition-all duration-200 ease-in-out'>
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
              <div className='flex items-center gap-[8px] pt-[8px]'>
                <Button
                  onClick={handleCopyContent}
                  variant='ghost'
                  title='Copy'
                  className='!h-[14px] !w-[14px] !p-0'
                >
                  {showCopySuccess ? (
                    <Check className='h-[14px] w-[14px]' strokeWidth={2} />
                  ) : (
                    <Copy className='h-[14px] w-[14px]' strokeWidth={2} />
                  )}
                </Button>
                <Button
                  onClick={handleUpvote}
                  variant='ghost'
                  title='Upvote'
                  className='!h-[14px] !w-[14px] !p-0'
                >
                  {showUpvoteSuccess ? (
                    <Check className='h-[14px] w-[14px]' strokeWidth={2} />
                  ) : (
                    <ThumbsUp className='h-[14px] w-[14px]' strokeWidth={2} />
                  )}
                </Button>
                <Button
                  onClick={handleDownvote}
                  variant='ghost'
                  title='Downvote'
                  className='!h-[14px] !w-[14px] !p-0'
                >
                  {showDownvoteSuccess ? (
                    <Check className='h-[14px] w-[14px]' strokeWidth={2} />
                  ) : (
                    <ThumbsDown className='h-[14px] w-[14px]' strokeWidth={2} />
                  )}
                </Button>
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
                      className='inline-flex max-w-full items-center rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground'
                    >
                      <span className='truncate'>{citation.title}</span>
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

    // If dimmed state changed, re-render
    if (prevProps.isDimmed !== nextProps.isDimmed) {
      return false
    }

    // If panel width changed, re-render
    if (prevProps.panelWidth !== nextProps.panelWidth) {
      return false
    }

    // If checkpoint count changed, re-render
    if (prevProps.checkpointCount !== nextProps.checkpointCount) {
      return false
    }

    // For streaming messages, check if content actually changed
    if (nextProps.isStreaming) {
      const prevBlocks = prevMessage.contentBlocks || []
      const nextBlocks = nextMessage.contentBlocks || []

      if (prevBlocks.length !== nextBlocks.length) {
        return false // Content blocks changed
      }

      // Helper: get last block content by type
      const getLastBlockContent = (blocks: any[], type: 'text' | 'thinking'): string | null => {
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i]
          if (block && block.type === type) {
            return (block as any).content ?? ''
          }
        }
        return null
      }

      // Re-render if the last text block content changed
      const prevLastTextContent = getLastBlockContent(prevBlocks as any[], 'text')
      const nextLastTextContent = getLastBlockContent(nextBlocks as any[], 'text')
      if (
        prevLastTextContent !== null &&
        nextLastTextContent !== null &&
        prevLastTextContent !== nextLastTextContent
      ) {
        return false
      }

      // Re-render if the last thinking block content changed
      const prevLastThinkingContent = getLastBlockContent(prevBlocks as any[], 'thinking')
      const nextLastThinkingContent = getLastBlockContent(nextBlocks as any[], 'thinking')
      if (
        prevLastThinkingContent !== null &&
        nextLastThinkingContent !== null &&
        prevLastThinkingContent !== nextLastThinkingContent
      ) {
        return false
      }

      // Check if tool calls changed
      const prevToolCalls = prevMessage.toolCalls || []
      const nextToolCalls = nextMessage.toolCalls || []

      if (prevToolCalls.length !== nextToolCalls.length) {
        return false // Tool calls count changed
      }

      for (let i = 0; i < nextToolCalls.length; i++) {
        if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) {
          return false // Tool call state changed
        }
      }

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
