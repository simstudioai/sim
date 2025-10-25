'use client'

import { type FC, memo, useMemo, useState } from 'react'
import {
  Blocks,
  BookOpen,
  Bot,
  Box,
  Check,
  Clipboard,
  CornerDownLeft,
  Info,
  LibraryBig,
  RotateCcw,
  Shapes,
  SquareChevronRight,
  ThumbsDown,
  ThumbsUp,
  Workflow,
  X,
} from 'lucide-react'
import { InlineToolCall } from '@/lib/copilot/inline-tool-call'
import { createLogger } from '@/lib/logs/console/logger'
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
 * Maximum number of visible context chips before showing "more" button
 */
const MAX_VISIBLE_CONTEXTS = 4

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
  onEditModeChange?: (isEditing: boolean) => void
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
    const [showAllContexts, setShowAllContexts] = useState(false)
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
      handleEditMessage,
      handleCancelEdit,
      handleMessageClick,
      handleSubmitEdit,
      performEdit,
    } = useMessageEditing({
      message,
      messages,
      isLastUserMessage,
      hasCheckpoints,
      onEditModeChange,
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
          className={`w-full max-w-full overflow-hidden py-0.5 transition-opacity duration-200 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
        >
          {isEditMode ? (
            <div ref={editContainerRef} className='relative w-full'>
              <UserInput
                ref={userInputRef}
                onSubmit={handleSubmitEdit}
                onAbort={handleCancelEdit}
                isLoading={isSendingMessage && isLastUserMessage}
                disabled={showCheckpointDiscardModal}
                value={editedContent}
                onChange={setEditedContent}
                placeholder='Edit your message...'
                mode={mode}
                onModeChange={setMode}
                panelWidth={panelWidth}
                hideContextUsage={true}
                clearOnSubmit={false}
              />

              {/* Inline Checkpoint Discard Confirmation - shown below input in edit mode */}
              {showCheckpointDiscardModal && (
                <div className='mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-900'>
                  <p className='mb-2 text-foreground text-sm'>Continue from a previous message?</p>
                  <div className='flex gap-1.5'>
                    <button
                      onClick={handleCancelCheckpointDiscard}
                      className='flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-muted px-2 py-1 text-foreground text-xs transition-colors hover:bg-muted/80 dark:border-gray-600 dark:bg-background dark:hover:bg-muted'
                    >
                      <span>Cancel</span>
                      <span className='text-[10px] text-muted-foreground'>(Esc)</span>
                    </button>
                    <button
                      onClick={handleContinueWithoutRevert}
                      className='flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:bg-muted dark:bg-muted dark:hover:bg-muted/80'
                    >
                      Continue
                    </button>
                    <button
                      onClick={handleContinueAndRevert}
                      className='flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--brand-primary-hover-hex)] px-2 py-1 text-white text-xs transition-colors hover:bg-[var(--brand-primary-hex)]'
                    >
                      <span>Continue and revert</span>
                      <CornerDownLeft className='h-3 w-3' />
                    </button>
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

              {/* Context chips displayed above the message box */}
              {(Array.isArray((message as any).contexts) && (message as any).contexts.length > 0) ||
              (Array.isArray(message.contentBlocks) &&
                (message.contentBlocks as any[]).some((b: any) => b?.type === 'contexts')) ? (
                <div className='mb-1.5 flex flex-wrap gap-1.5'>
                  {(() => {
                    const direct = Array.isArray((message as any).contexts)
                      ? ((message as any).contexts as any[])
                      : []
                    const block = Array.isArray(message.contentBlocks)
                      ? (message.contentBlocks as any[]).find((b: any) => b?.type === 'contexts')
                      : null
                    const fromBlock = Array.isArray((block as any)?.contexts)
                      ? ((block as any).contexts as any[])
                      : []
                    const allContexts = (direct.length > 0 ? direct : fromBlock).filter(
                      (c: any) => c?.kind !== 'current_workflow'
                    )
                    const visible = showAllContexts
                      ? allContexts
                      : allContexts.slice(0, MAX_VISIBLE_CONTEXTS)
                    return (
                      <>
                        {visible.map((ctx: any, idx: number) => (
                          <span
                            key={`ctx-${idx}-${ctx?.label || ctx?.kind}`}
                            className='inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_14%,transparent)] px-1.5 py-0.5 text-[11px] text-foreground'
                            title={ctx?.label || ctx?.kind}
                          >
                            {ctx?.kind === 'past_chat' ? (
                              <Bot className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'workflow' || ctx?.kind === 'current_workflow' ? (
                              <Workflow className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'blocks' ? (
                              <Blocks className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'workflow_block' ? (
                              <Box className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'knowledge' ? (
                              <LibraryBig className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'templates' ? (
                              <Shapes className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'docs' ? (
                              <BookOpen className='h-3 w-3 text-muted-foreground' />
                            ) : ctx?.kind === 'logs' ? (
                              <SquareChevronRight className='h-3 w-3 text-muted-foreground' />
                            ) : (
                              <Info className='h-3 w-3 text-muted-foreground' />
                            )}
                            <span className='max-w-[140px] truncate'>
                              {ctx?.label || ctx?.kind}
                            </span>
                          </span>
                        ))}
                        {allContexts.length > MAX_VISIBLE_CONTEXTS && (
                          <button
                            type='button'
                            onClick={() => setShowAllContexts((v: boolean) => !v)}
                            className='inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_10%,transparent)] px-1.5 py-0.5 text-[11px] text-foreground hover:bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_14%,transparent)]'
                            title={
                              showAllContexts
                                ? 'Show less'
                                : `Show ${allContexts.length - MAX_VISIBLE_CONTEXTS} more`
                            }
                          >
                            {showAllContexts
                              ? 'Show less'
                              : `+${allContexts.length - MAX_VISIBLE_CONTEXTS} more`}
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>
              ) : null}

              {/* Message box - styled like input, clickable to edit */}
              <div
                data-message-box
                data-message-id={message.id}
                onClick={handleMessageClick}
                onMouseEnter={() => setIsHoveringMessage(true)}
                onMouseLeave={() => setIsHoveringMessage(false)}
                className='group relative cursor-text rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] px-3 py-1.5 shadow-xs transition-all duration-200 hover:border-[#D0D0D0] dark:border-[#414141] dark:bg-[var(--surface-elevated)] dark:hover:border-[#525252]'
              >
                <div
                  ref={messageContentRef}
                  className={`relative whitespace-pre-wrap break-words py-1 pl-[2px] font-sans text-foreground text-sm leading-[1.25rem] ${isSendingMessage && isLastUserMessage ? 'pr-10' : 'pr-2'} ${!isExpanded && needsExpansion ? 'max-h-[60px] overflow-hidden' : 'overflow-visible'}`}
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
                          className='rounded-[6px] bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_14%,transparent)] px-1'
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

                  {/* Gradient fade when truncated */}
                  {!isExpanded && needsExpansion && (
                    <div className='absolute right-0 bottom-0 left-0 h-8 bg-gradient-to-t from-[#FFFFFF] to-transparent dark:from-[var(--surface-elevated)]' />
                  )}
                </div>

                {/* Abort button when hovering and response is generating (only on last user message) */}
                {isSendingMessage && isHoveringMessage && isLastUserMessage && (
                  <div className='absolute right-2 bottom-2'>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        abortMessage()
                      }}
                      className='flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
                      title='Stop generation'
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </div>
                )}

                {/* Revert button on hover (only when has checkpoints and not generating) */}
                {!isSendingMessage && hasCheckpoints && (
                  <div className='pointer-events-auto absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100'>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRevertToCheckpoint()
                      }}
                      className='flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-all duration-200 hover:bg-muted-foreground/20'
                      title='Revert to checkpoint'
                    >
                      <RotateCcw className='h-3 w-3' />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inline Restore Checkpoint Confirmation */}
          {showRestoreConfirmation && (
            <div className='mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5 dark:border-gray-700 dark:bg-gray-900'>
              <p className='mb-2 text-foreground text-sm'>
                Revert to checkpoint? This will restore your workflow to the state saved at this
                checkpoint.{' '}
                <span className='font-medium text-red-600 dark:text-red-400'>
                  This action cannot be undone.
                </span>
              </p>
              <div className='flex gap-1.5'>
                <button
                  onClick={handleCancelRevert}
                  className='flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-muted px-2 py-1 text-foreground text-xs transition-colors hover:bg-muted/80 dark:border-gray-600'
                >
                  <span>Cancel</span>
                  <span className='text-[10px] text-muted-foreground'>(Esc)</span>
                </button>
                <button
                  onClick={handleConfirmRevert}
                  className='flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-500 px-2 py-1 text-white text-xs transition-colors hover:bg-red-600'
                >
                  <span>Revert</span>
                  <CornerDownLeft className='h-3 w-3' />
                </button>
              </div>
            </div>
          )}
        </div>
      )
    }

    if (isAssistant) {
      return (
        <div
          className={`w-full max-w-full overflow-hidden py-0.5 pl-[2px] transition-opacity duration-200 ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
        >
          <div className='max-w-full space-y-1.5 transition-all duration-200 ease-in-out'>
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
