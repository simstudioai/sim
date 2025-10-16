'use client'

import { type FC, memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Blocks,
  BookOpen,
  Bot,
  Box,
  Check,
  Clipboard,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Checkbox,
} from '@/components/ui'
import { InlineToolCall } from '@/lib/copilot/inline-tool-call'
import { createLogger } from '@/lib/logs/console/logger'
import {
  FileAttachmentDisplay,
  SmoothStreamingText,
  StreamingIndicator,
  ThinkingBlock,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components'
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'
import { UserInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/user-input'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { useCopilotStore } from '@/stores/copilot/store'
import type { CopilotMessage as CopilotMessageType } from '@/stores/copilot/types'

const logger = createLogger('CopilotMessage')

interface CopilotMessageProps {
  message: CopilotMessageType
  isStreaming?: boolean
  panelWidth?: number
}

const CopilotMessage: FC<CopilotMessageProps> = memo(
  ({ message, isStreaming, panelWidth = 308 }) => {
    const isUser = message.role === 'user'
    const isAssistant = message.role === 'assistant'
    const [showCopySuccess, setShowCopySuccess] = useState(false)
    const [showUpvoteSuccess, setShowUpvoteSuccess] = useState(false)
    const [showDownvoteSuccess, setShowDownvoteSuccess] = useState(false)
  const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false)
  const [showAllContexts, setShowAllContexts] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [editedContent, setEditedContent] = useState(message.content)
  const [isHoveringMessage, setIsHoveringMessage] = useState(false)
  const editContainerRef = useRef<HTMLDivElement>(null)
  const messageContentRef = useRef<HTMLDivElement>(null)
  const [needsExpansion, setNeedsExpansion] = useState(false)
  const [showCheckpointDiscardModal, setShowCheckpointDiscardModal] = useState(false)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const pendingEditRef = useRef<{
    message: string
    fileAttachments?: any[]
    contexts?: any[]
  } | null>(null)

    // Get checkpoint functionality from copilot store
    const {
      messageCheckpoints: allMessageCheckpoints,
      revertToCheckpoint,
      isRevertingCheckpoint,
      currentChat,
      messages,
      workflowId,
      sendMessage,
      isSendingMessage,
      abortMessage,
      mode,
      setMode,
    } = useCopilotStore()

    // Get preview store for accessing workflow YAML after rejection
    const { getPreviewByToolCall, getLatestPendingPreview } = usePreviewStore()

    // Import COPILOT_TOOL_IDS - placing it here since it's needed in multiple functions
    const WORKFLOW_TOOL_NAMES = ['edit_workflow']

    // Get checkpoints for this message if it's a user message
    const messageCheckpoints = isUser ? allMessageCheckpoints[message.id] || [] : []
    // Only consider it as having checkpoints if there's at least one valid checkpoint with an id
    const hasCheckpoints = messageCheckpoints.length > 0 && messageCheckpoints.some(cp => cp?.id)

    // Check if this is the last user message (for showing abort button)
    const isLastUserMessage = useMemo(() => {
      if (!isUser) return false
      const userMessages = messages.filter((m) => m.role === 'user')
      return userMessages.length > 0 && userMessages[userMessages.length - 1]?.id === message.id
    }, [isUser, messages, message.id])

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

      // Find workflow tools (edit_workflow)
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

    const handleEditMessage = () => {
      setIsEditMode(true)
      setIsExpanded(false)
      setEditedContent(message.content)
    }

    const handleCancelEdit = () => {
      setIsEditMode(false)
      setEditedContent(message.content)
    }

    const handleMessageClick = () => {
      if (isSendingMessage) return

      // If message needs expansion and is not expanded, expand it
      if (needsExpansion && !isExpanded) {
        setIsExpanded(true)
      }

      // Always enter edit mode on click
      handleEditMessage()
    }

    const handleSubmitEdit = async (
      editedMessage: string,
      fileAttachments?: any[],
      contexts?: any[]
    ) => {
      if (!editedMessage.trim() || isSendingMessage) return

      // Check if this message has checkpoints and user hasn't opted out
      if (hasCheckpoints && !dontAskAgain) {
        // Store the pending edit
        pendingEditRef.current = { message: editedMessage, fileAttachments, contexts }
        // Show confirmation modal
        setShowCheckpointDiscardModal(true)
        return
      }

      // Proceed with the edit
      await performEdit(editedMessage, fileAttachments, contexts)
    }

    const performEdit = async (
      editedMessage: string,
      fileAttachments?: any[],
      contexts?: any[]
    ) => {
      // Find the index of this message and truncate conversation
      const currentMessages = messages
      const editIndex = currentMessages.findIndex((m) => m.id === message.id)

      if (editIndex !== -1) {
        // Exit edit mode immediately
        setIsEditMode(false)

        // Truncate messages after the edited message (remove it and everything after)
        const truncatedMessages = currentMessages.slice(0, editIndex)

        // Update store to show only messages before the edit point
        useCopilotStore.setState({ messages: truncatedMessages })

        // If we have a current chat, update the DB to remove messages after this point
        if (currentChat?.id) {
          try {
            await fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chatId: currentChat.id,
                messages: truncatedMessages.map((m) => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp,
                  ...(m.contentBlocks && { contentBlocks: m.contentBlocks }),
                  ...(m.fileAttachments && { fileAttachments: m.fileAttachments }),
                  ...((m as any).contexts && { contexts: (m as any).contexts }),
                })),
              }),
            })
          } catch (error) {
            logger.error('Failed to update messages in DB after edit:', error)
          }
        }

        // Send the edited message with the SAME message ID
        await sendMessage(editedMessage, {
          fileAttachments: fileAttachments || message.fileAttachments,
          contexts: contexts || (message as any).contexts,
          messageId: message.id, // Reuse the original message ID
        })
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

    // Handle click outside to exit edit mode
    useEffect(() => {
      if (!isEditMode) return

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement

        // Don't close if clicking inside the edit container
        if (editContainerRef.current?.contains(target)) {
          return
        }

        // Check if clicking on another user message box
        const clickedMessageBox = target.closest('[data-message-box]') as HTMLElement
        if (clickedMessageBox) {
          const clickedMessageId = clickedMessageBox.getAttribute('data-message-id')
          // If clicking on a different message, close this one (the other will open via its own click handler)
          if (clickedMessageId && clickedMessageId !== message.id) {
            handleCancelEdit()
          }
          return
        }

        // Check if clicking on the main user input at the bottom
        if (target.closest('textarea') || target.closest('input[type="text"]')) {
          handleCancelEdit()
          return
        }

        // Only close if NOT clicking on any component (i.e., clicking directly on panel background)
        // If the target has children or is a component, don't close
        if (target.children.length > 0 || target.tagName !== 'DIV') {
          return
        }

        handleCancelEdit()
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          handleCancelEdit()
        }
      }

      // Use click event instead of mousedown to allow the target's click handler to fire first
      // Add listener with a slight delay to avoid immediate trigger when entering edit mode
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickOutside, true) // Use capture phase
        document.addEventListener('keydown', handleKeyDown)
      }, 100)

      return () => {
        clearTimeout(timeoutId)
        document.removeEventListener('click', handleClickOutside, true)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }, [isEditMode, message.id])

    // Check if message content needs expansion (is tall)
    useEffect(() => {
      if (messageContentRef.current && isUser) {
        const scrollHeight = messageContentRef.current.scrollHeight
        const clientHeight = messageContentRef.current.clientHeight
        // If content is taller than the max height (3 lines ~60px), mark as needing expansion
        setNeedsExpansion(scrollHeight > 60)
      }
    }, [message.content, isUser])

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
          // Visibility and filtering handled by InlineToolCall
          return (
            <div
              key={`tool-${block.toolCall.id}`}
              className='transition-opacity duration-300 ease-in-out'
              style={{ opacity: 1 }}
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
        <div className='w-full max-w-full overflow-hidden py-0.5'>
          {isEditMode ? (
            <div ref={editContainerRef} className='relative w-full'>
              <UserInput
                onSubmit={handleSubmitEdit}
                onAbort={handleCancelEdit}
                isLoading={isSendingMessage}
                value={editedContent}
                onChange={setEditedContent}
                placeholder='Edit your message...'
                mode={mode}
                onModeChange={setMode}
                panelWidth={panelWidth}
                hideContextUsage={true}
              />
              {/* Revert button in edit mode (only if has checkpoints) */}
              {hasCheckpoints && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowRestoreConfirmation(true)
                  }}
                  className='absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-all duration-200 hover:bg-muted-foreground/20'
                  title='Revert to checkpoint'
                >
                  <RotateCcw className='h-3 w-3' />
                </button>
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
                    const MAX_VISIBLE = 4
                    const visible = showAllContexts
                      ? allContexts
                      : allContexts.slice(0, MAX_VISIBLE)
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
                        {allContexts.length > MAX_VISIBLE && (
                          <button
                            type='button'
                            onClick={() => setShowAllContexts((v) => !v)}
                            className='inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_10%,transparent)] px-1.5 py-0.5 text-[11px] text-foreground hover:bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_14%,transparent)]'
                            title={
                              showAllContexts
                                ? 'Show less'
                                : `Show ${allContexts.length - MAX_VISIBLE} more`
                            }
                          >
                            {showAllContexts
                              ? 'Show less'
                              : `+${allContexts.length - MAX_VISIBLE} more`}
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
                onClick={!isSendingMessage ? handleMessageClick : undefined}
                onMouseEnter={() => setIsHoveringMessage(true)}
                onMouseLeave={() => setIsHoveringMessage(false)}
                className='group relative cursor-text rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] px-3 py-1.5 shadow-xs transition-all duration-200 hover:border-[#D0D0D0] dark:border-[#414141] dark:bg-[var(--surface-elevated)] dark:hover:border-[#525252]'
              >
                <div
                  ref={messageContentRef}
                  className='whitespace-pre-wrap break-words py-1 pr-2 pl-[2px] font-sans text-foreground text-sm leading-[1.25rem]'
                  style={{
                    maxHeight: !isExpanded && needsExpansion ? '60px' : 'none',
                    overflow: !isExpanded && needsExpansion ? 'hidden' : 'visible',
                    position: 'relative',
                  }}
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
                  <div className='absolute top-2 right-2'>
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
                        setShowRestoreConfirmation(true)
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

          {/* Restore Checkpoint Confirmation Modal */}
          <AlertDialog open={showRestoreConfirmation} onOpenChange={setShowRestoreConfirmation}>
            <AlertDialogContent className='rounded-[10px]'>
              <AlertDialogHeader>
                <AlertDialogTitle>Revert to checkpoint?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will revert your workflow to the state saved at this checkpoint.{' '}
                  <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className='flex'>
                <AlertDialogCancel className='h-9 w-full rounded-[8px]'>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmRevert}
                  className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                >
                  Revert
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Restore Checkpoint Confirmation Modal */}
          <AlertDialog open={showRestoreConfirmation} onOpenChange={setShowRestoreConfirmation}>
            <AlertDialogContent className='rounded-[10px]'>
              <AlertDialogHeader>
                <AlertDialogTitle>Revert to checkpoint?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will revert your workflow to the state saved at this checkpoint.{' '}
                  <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className='flex'>
                <AlertDialogCancel className='h-9 w-full rounded-[8px]'>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmRevert}
                  className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
                >
                  Revert
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Checkpoint Discard Confirmation Modal */}
          <AlertDialog
            open={showCheckpointDiscardModal}
            onOpenChange={(open) => {
              setShowCheckpointDiscardModal(open)
              if (!open) {
                pendingEditRef.current = null
              }
            }}
          >
            <AlertDialogContent className='rounded-[10px]'>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit from a previous message?</AlertDialogTitle>
                <AlertDialogDescription>
                  Submitting from a previous message will revert file changes to before this message
                  and clear the messages after this one.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className='flex items-center space-x-2 px-6 py-2'>
                <Checkbox
                  id='dont-ask-checkpoint-discard'
                  checked={dontAskAgain}
                  onCheckedChange={(checked) => setDontAskAgain(!!checked)}
                />
                <label
                  htmlFor='dont-ask-checkpoint-discard'
                  className='cursor-pointer text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                >
                  Don't ask again
                </label>
              </div>

              <AlertDialogFooter className='flex gap-2'>
                <AlertDialogCancel className='h-9 flex-1 rounded-[8px]'>
                  Cancel (esc)
                </AlertDialogCancel>
                <button
                  onClick={async (e) => {
                    e.preventDefault()
                    setShowCheckpointDiscardModal(false)

                    // Proceed with edit WITHOUT reverting checkpoint
                    if (pendingEditRef.current) {
                      const { message, fileAttachments, contexts } = pendingEditRef.current
                      await performEdit(message, fileAttachments, contexts)
                      pendingEditRef.current = null
                    }
                  }}
                  className='inline-flex h-9 flex-1 items-center justify-center rounded-[8px] border border-border bg-background px-4 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                >
                  Continue without reverting
                </button>
                <button
                  onClick={async (e) => {
                    e.preventDefault()

                    // Restore the checkpoint first
                    if (messageCheckpoints.length > 0) {
                      const latestCheckpoint = messageCheckpoints[0]
                      try {
                        await revertToCheckpoint(latestCheckpoint.id)
                        logger.info('Reverted to checkpoint before editing message')
                      } catch (error) {
                        logger.error('Failed to revert to checkpoint:', error)
                      }
                    }

                    // Close the modal
                    setShowCheckpointDiscardModal(false)

                    // Then proceed with the edit
                    if (pendingEditRef.current) {
                      const { message, fileAttachments, contexts } = pendingEditRef.current
                      await performEdit(message, fileAttachments, contexts)
                      pendingEditRef.current = null
                    }
                  }}
                  className='inline-flex h-9 flex-1 items-center justify-center rounded-[8px] bg-primary px-4 py-2 font-medium text-sm text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                >
                  Continue and revert ↻
                </button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )
    }

    if (isAssistant) {
      return (
        <div className='w-full max-w-full overflow-hidden py-0.5 pl-[2px]'>
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
