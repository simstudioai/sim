'use client'

import { type FC, memo, useCallback, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/emcn'
import {
  OptionsSelector,
  parseSpecialTags,
  ToolCall,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components'
import {
  CheckpointConfirmation,
  FileAttachmentDisplay,
  SmoothStreamingText,
  StreamingIndicator,
  ThinkingBlock,
  UsageLimitActions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components'
import { CopilotMarkdownRenderer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'
import {
  useCheckpointManagement,
  useMessageEditing,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/hooks'
import { UserInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/user-input'
import { buildMentionHighlightNodes } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import type { CopilotMessage as CopilotMessageType } from '@/stores/panel'
import { useCopilotStore } from '@/stores/panel'

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
  /** Whether this is the last message in the conversation */
  isLastMessage?: boolean
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
    isLastMessage = false,
  }) => {
    const isUser = message.role === 'user'
    const isAssistant = message.role === 'assistant'

    const {
      messageCheckpoints: allMessageCheckpoints,
      messages,
      isSendingMessage,
      abortMessage,
      mode,
      setMode,
      isAborting,
    } = useCopilotStore()

    const maskCredentialValue = useCopilotStore((s) => s.maskCredentialValue)

    const messageCheckpoints = isUser ? allMessageCheckpoints[message.id] || [] : []
    const hasCheckpoints = messageCheckpoints.length > 0 && messageCheckpoints.some((cp) => cp?.id)

    const isLastUserMessage = useMemo(() => {
      if (!isUser) return false
      const userMessages = messages.filter((m) => m.role === 'user')
      return userMessages.length > 0 && userMessages[userMessages.length - 1]?.id === message.id
    }, [isUser, messages, message.id])

    const [isHoveringMessage, setIsHoveringMessage] = useState(false)
    const cancelEditRef = useRef<(() => void) | null>(null)

    const {
      showRestoreConfirmation,
      showCheckpointDiscardModal,
      isReverting,
      isProcessingDiscard,
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
      onEditModeChange,
      () => cancelEditRef.current?.()
    )

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

    cancelEditRef.current = handleCancelEdit

    const cleanTextContent = useMemo(() => {
      if (!message.content) return ''
      return message.content.replace(/\n{3,}/g, '\n\n')
    }, [message.content])

    const parsedTags = useMemo(() => {
      if (isUser) return null

      if (message.content) {
        const parsed = parseSpecialTags(message.content)
        if (parsed.options || parsed.plan) return parsed
      }

      if (message.contentBlocks && message.contentBlocks.length > 0) {
        for (const block of message.contentBlocks) {
          if (block.type === 'text' && block.content) {
            const parsed = parseSpecialTags(block.content)
            if (parsed.options || parsed.plan) return parsed
          }
        }
      }

      return null
    }, [message.content, message.contentBlocks, isUser])

    const selectedOptionKey = useMemo(() => {
      if (!parsedTags?.options || isStreaming) return null

      const currentIndex = messages.findIndex((m) => m.id === message.id)
      if (currentIndex === -1 || currentIndex >= messages.length - 1) return null

      const nextMessage = messages[currentIndex + 1]
      if (!nextMessage || nextMessage.role !== 'user') return null

      const nextContent = nextMessage.content?.trim()
      if (!nextContent) return null

      for (const [key, option] of Object.entries(parsedTags.options)) {
        const optionTitle = typeof option === 'string' ? option : option.title
        if (nextContent === optionTitle) {
          return key
        }
      }

      return null
    }, [parsedTags?.options, messages, message.id, isStreaming])

    const sendMessage = useCopilotStore((s) => s.sendMessage)

    const handleOptionSelect = useCallback(
      (_optionKey: string, optionText: string) => {
        sendMessage(optionText)
      },
      [sendMessage]
    )

    const isActivelyStreaming = isLastMessage && isStreaming

    const memoizedContentBlocks = useMemo(() => {
      if (!message.contentBlocks || message.contentBlocks.length === 0) {
        return null
      }

      return message.contentBlocks.map((block, index) => {
        if (block.type === 'text') {
          const isLastTextBlock =
            index === message.contentBlocks!.length - 1 && block.type === 'text'
          const parsed = parseSpecialTags(block.content)
          // Mask credential IDs in the displayed content
          const cleanBlockContent = maskCredentialValue(
            parsed.cleanContent.replace(/\n{3,}/g, '\n\n')
          )

          if (!cleanBlockContent.trim()) return null

          const shouldUseSmoothing = isActivelyStreaming && isLastTextBlock
          const blockKey = `text-${index}-${block.timestamp || index}`

          return (
            <div key={blockKey} className='w-full max-w-full'>
              {shouldUseSmoothing ? (
                <SmoothStreamingText
                  content={cleanBlockContent}
                  isStreaming={isActivelyStreaming}
                />
              ) : (
                <CopilotMarkdownRenderer content={cleanBlockContent} />
              )}
            </div>
          )
        }
        if (block.type === 'thinking') {
          const hasFollowingContent = index < message.contentBlocks!.length - 1
          const hasSpecialTags = !!(parsedTags?.options || parsedTags?.plan)
          const blockKey = `thinking-${index}-${block.timestamp || index}`

          return (
            <div key={blockKey} className='w-full'>
              <ThinkingBlock
                content={maskCredentialValue(block.content)}
                isStreaming={isActivelyStreaming}
                hasFollowingContent={hasFollowingContent}
                hasSpecialTags={hasSpecialTags}
              />
            </div>
          )
        }
        if (block.type === 'tool_call') {
          const blockKey = `tool-${block.toolCall.id}`

          return (
            <div key={blockKey}>
              <ToolCall
                toolCallId={block.toolCall.id}
                toolCall={block.toolCall}
                isCurrentMessage={isLastMessage}
              />
            </div>
          )
        }
        return null
      })
    }, [message.contentBlocks, isActivelyStreaming, parsedTags, isLastMessage])

    if (isUser) {
      return (
        <div
          className={`w-full max-w-full flex-none overflow-hidden transition-opacity duration-200 [max-width:var(--panel-max-width)] ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
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
                initialContexts={message.contexts}
              />

              {/* Inline checkpoint confirmation - shown below input in edit mode */}
              {showCheckpointDiscardModal && (
                <CheckpointConfirmation
                  variant='discard'
                  isProcessing={isProcessingDiscard}
                  onCancel={handleCancelCheckpointDiscard}
                  onRevert={handleContinueAndRevert}
                  onContinue={handleContinueWithoutRevert}
                />
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
                className='group relative w-full cursor-pointer rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-4)] px-[6px] py-[6px] transition-all duration-200 hover:border-[var(--surface-7)] hover:bg-[var(--surface-4)] dark:bg-[var(--surface-4)] dark:hover:border-[var(--surface-7)] dark:hover:bg-[var(--border-1)]'
              >
                <div
                  ref={messageContentRef}
                  className={`relative whitespace-pre-wrap break-words px-[2px] py-1 font-medium font-sans text-[var(--text-primary)] text-sm leading-[1.25rem] ${isSendingMessage && isLastUserMessage && isHoveringMessage ? 'pr-7' : ''} ${!isExpanded && needsExpansion ? 'max-h-[60px] overflow-hidden' : 'overflow-visible'}`}
                >
                  {buildMentionHighlightNodes(
                    message.content || '',
                    message.contexts || [],
                    (token, key) => (
                      <span key={key} className='rounded-[4px] bg-[rgba(50,189,126,0.65)] py-[1px]'>
                        {token}
                      </span>
                    )
                  )}
                </div>

                {/* Gradient fade when truncated - applies to entire message box */}
                {!isExpanded && needsExpansion && (
                  <div className='pointer-events-none absolute right-0 bottom-0 left-0 h-6 bg-gradient-to-t from-0% from-[var(--surface-4)] via-25% via-[var(--surface-4)] to-100% to-transparent opacity-40 group-hover:opacity-30 dark:from-[var(--surface-4)] dark:via-[var(--surface-4)] dark:group-hover:from-[var(--border-1)] dark:group-hover:via-[var(--border-1)]' />
                )}

                {/* Abort button when hovering and response is generating (only on last user message) */}
                {isSendingMessage && isHoveringMessage && isLastUserMessage && (
                  <div className='pointer-events-auto absolute right-[6px] bottom-[6px]'>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        abortMessage()
                      }}
                      className='h-[20px] w-[20px] rounded-full border-0 bg-[var(--c-383838)] p-0 transition-colors hover:bg-[var(--c-575757)] dark:bg-[var(--c-E0E0E0)] dark:hover:bg-[var(--c-CFCFCF)]'
                      title='Stop generation'
                    >
                      <svg
                        className='block h-[13px] w-[13px] fill-white dark:fill-black'
                        viewBox='0 0 24 24'
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

          {/* Inline restore checkpoint confirmation */}
          {showRestoreConfirmation && (
            <CheckpointConfirmation
              variant='restore'
              isProcessing={isReverting}
              onCancel={handleCancelRevert}
              onRevert={handleConfirmRevert}
            />
          )}
        </div>
      )
    }

    if (isAssistant) {
      return (
        <div
          className={`w-full max-w-full flex-none overflow-hidden [max-width:var(--panel-max-width)] ${isDimmed ? 'opacity-40' : 'opacity-100'}`}
          style={{ '--panel-max-width': `${panelWidth - 16}px` } as React.CSSProperties}
        >
          <div className='max-w-full space-y-[4px] px-[2px] pb-[4px]'>
            {/* Content blocks in chronological order */}
            {memoizedContentBlocks || (isStreaming && <div className='min-h-0' />)}

            {isStreaming && <StreamingIndicator />}

            {message.errorType === 'usage_limit' && (
              <div className='flex gap-1.5'>
                <UsageLimitActions />
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

            {/* Options selector when agent presents choices - streams in but disabled until complete */}
            {/* Disabled for previous messages (not isLastMessage) so only the latest options are interactive */}
            {parsedTags?.options && Object.keys(parsedTags.options).length > 0 && (
              <OptionsSelector
                options={parsedTags.options}
                onSelect={handleOptionSelect}
                disabled={!isLastMessage || isSendingMessage || isStreaming}
                enableKeyboardNav={
                  isLastMessage && !isStreaming && parsedTags.optionsComplete === true
                }
                streaming={isStreaming || !parsedTags.optionsComplete}
                selectedOptionKey={selectedOptionKey}
              />
            )}
          </div>
        </div>
      )
    }

    return null
  },
  (prevProps, nextProps) => {
    const prevMessage = prevProps.message
    const nextMessage = nextProps.message

    if (prevMessage.id !== nextMessage.id) return false
    if (prevProps.isStreaming !== nextProps.isStreaming) return false
    if (prevProps.isDimmed !== nextProps.isDimmed) return false
    if (prevProps.panelWidth !== nextProps.panelWidth) return false
    if (prevProps.checkpointCount !== nextProps.checkpointCount) return false
    if (prevProps.isLastMessage !== nextProps.isLastMessage) return false

    if (nextProps.isStreaming) {
      const prevBlocks = prevMessage.contentBlocks || []
      const nextBlocks = nextMessage.contentBlocks || []

      if (prevBlocks.length !== nextBlocks.length) return false

      const getLastBlockContent = (blocks: any[], type: 'text' | 'thinking'): string | null => {
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i]
          if (block && block.type === type) {
            return (block as any).content ?? ''
          }
        }
        return null
      }

      const prevLastTextContent = getLastBlockContent(prevBlocks as any[], 'text')
      const nextLastTextContent = getLastBlockContent(nextBlocks as any[], 'text')
      if (
        prevLastTextContent !== null &&
        nextLastTextContent !== null &&
        prevLastTextContent !== nextLastTextContent
      ) {
        return false
      }

      const prevLastThinkingContent = getLastBlockContent(prevBlocks as any[], 'thinking')
      const nextLastThinkingContent = getLastBlockContent(nextBlocks as any[], 'thinking')
      if (
        prevLastThinkingContent !== null &&
        nextLastThinkingContent !== null &&
        prevLastThinkingContent !== nextLastThinkingContent
      ) {
        return false
      }

      const prevToolCalls = prevMessage.toolCalls || []
      const nextToolCalls = nextMessage.toolCalls || []

      if (prevToolCalls.length !== nextToolCalls.length) return false

      for (let i = 0; i < nextToolCalls.length; i++) {
        if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) return false
      }

      return true
    }

    if (
      prevMessage.content !== nextMessage.content ||
      prevMessage.role !== nextMessage.role ||
      (prevMessage.toolCalls?.length || 0) !== (nextMessage.toolCalls?.length || 0) ||
      (prevMessage.contentBlocks?.length || 0) !== (nextMessage.contentBlocks?.length || 0)
    ) {
      return false
    }

    const prevToolCalls = prevMessage.toolCalls || []
    const nextToolCalls = nextMessage.toolCalls || []
    for (let i = 0; i < nextToolCalls.length; i++) {
      if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) return false
    }

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
        return false
      }
    }

    return true
  }
)

CopilotMessage.displayName = 'CopilotMessage'

export { CopilotMessage }
