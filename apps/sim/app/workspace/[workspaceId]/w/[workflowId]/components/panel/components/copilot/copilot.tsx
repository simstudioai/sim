'use client'

import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createLogger } from '@sim/logger'
import { History, Plus } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
} from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { cn } from '@/lib/core/utils/cn'
import {
  ChatHistorySkeleton,
  CopilotMessage,
  PlanModeSection,
  QueuedMessages,
  TodoList,
  UserInput,
  Welcome,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components'
import type { MessageFileAttachment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-file-attachments'
import type { UserInputRef } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/user-input'
import {
  useChatHistory,
  useCopilotInitialization,
  useLandingPrompt,
  useTodoManagement,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/hooks'
import { useScrollManagement } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import type { ChatContext } from '@/stores/panel'
import { useCopilotStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Copilot')

/**
 * Props for the Copilot component
 */
interface CopilotProps {
  /** Width of the copilot panel in pixels */
  panelWidth: number
}

/**
 * Ref interface for imperative actions on the Copilot component
 */
interface CopilotRef {
  /** Creates a new chat session */
  createNewChat: () => void
  /** Sets the input value and focuses the textarea */
  setInputValueAndFocus: (value: string) => void
  /** Focuses the copilot user input without changing its value */
  focusInput: () => void
}

/**
 * Copilot component - AI-powered assistant for workflow management
 * Provides chat interface, message history, and intelligent workflow suggestions
 */
export const Copilot = forwardRef<CopilotRef, CopilotProps>(({ panelWidth }, ref) => {
  const userInputRef = useRef<UserInputRef>(null)
  const copilotContainerRef = useRef<HTMLDivElement>(null)
  const cancelEditCallbackRef = useRef<(() => void) | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [revertingMessageId, setRevertingMessageId] = useState<string | null>(null)
  const [isHistoryDropdownOpen, setIsHistoryDropdownOpen] = useState(false)

  // Derived state - editing when there's an editingMessageId
  const isEditingMessage = editingMessageId !== null

  const { activeWorkflowId } = useWorkflowRegistry()

  const {
    messages,
    chats,
    isLoadingChats,
    isSendingMessage,
    isAborting,
    mode,
    inputValue,
    planTodos,
    showPlanTodos,
    streamingPlanContent,
    sendMessage,
    abortMessage,
    createNewChat,
    setMode,
    setInputValue,
    chatsLoadedForWorkflow,
    setWorkflowId: setCopilotWorkflowId,
    loadChats,
    messageCheckpoints,
    currentChat,
    selectChat,
    deleteChat,
    areChatsFresh,
    workflowId: copilotWorkflowId,
    setPlanTodos,
    closePlanTodos,
    clearPlanArtifact,
    savePlanArtifact,
    loadAutoAllowedTools,
  } = useCopilotStore()

  // Initialize copilot
  const { isInitialized } = useCopilotInitialization({
    activeWorkflowId,
    isLoadingChats,
    chatsLoadedForWorkflow,
    setCopilotWorkflowId,
    loadChats,
    loadAutoAllowedTools,
    currentChat,
    isSendingMessage,
  })

  // Handle scroll management (80px stickiness for copilot)
  const { scrollAreaRef, scrollToBottom } = useScrollManagement(messages, isSendingMessage, {
    stickinessThreshold: 40,
  })

  // Handle chat history grouping
  const { groupedChats, handleHistoryDropdownOpen: handleHistoryDropdownOpenHook } = useChatHistory(
    {
      chats,
      activeWorkflowId,
      copilotWorkflowId,
      loadChats,
      areChatsFresh,
      isSendingMessage,
    }
  )

  // Handle todo management
  const { todosCollapsed, setTodosCollapsed } = useTodoManagement({
    isSendingMessage,
    showPlanTodos,
    planTodos,
  })

  /** Gets markdown content for design document section (available in all modes once created) */
  const designDocumentContent = useMemo(() => {
    if (streamingPlanContent) {
      logger.info('[DesignDocument] Using streaming plan content', {
        contentLength: streamingPlanContent.length,
      })
      return streamingPlanContent
    }

    return ''
  }, [streamingPlanContent])

  /** Focuses the copilot input */
  const focusInput = useCallback(() => {
    userInputRef.current?.focus()
  }, [])

  // Handle landing page prompt retrieval and population
  useLandingPrompt({
    isInitialized,
    setInputValue,
    focusInput,
    isSendingMessage,
    currentInputValue: inputValue,
  })

  /** Auto-scrolls to bottom when chat loads */
  useEffect(() => {
    if (isInitialized && messages.length > 0) {
      scrollToBottom()
    }
  }, [isInitialized, messages.length, scrollToBottom])

  /** Cleanup on unmount - aborts active streaming. Uses refs to avoid stale closures */
  const isSendingRef = useRef(isSendingMessage)
  isSendingRef.current = isSendingMessage
  const abortMessageRef = useRef(abortMessage)
  abortMessageRef.current = abortMessage

  useEffect(() => {
    return () => {
      if (isSendingRef.current) {
        abortMessageRef.current()
        logger.info('Aborted active message streaming due to component unmount')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Cancels edit mode when clicking outside the current edit area */
  const handleCopilotClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!isEditingMessage) return
      const target = event.target as HTMLElement
      // Allow interactions with Radix portals (dropdowns, tooltips, dialogs, popovers, mention menu)
      if (
        target.closest('[data-radix-dropdown-menu-content]') ||
        target.closest('[data-radix-popover-content]') ||
        target.closest('[data-radix-dialog-content]') ||
        target.closest('[data-radix-tooltip-content]') ||
        target.closest('[data-radix-popper-content-wrapper]') ||
        target.closest('.mention-menu-portal') ||
        target.closest('[role="dialog"]') ||
        target.closest('[role="menu"]')
      ) {
        return
      }
      const editContainer = copilotContainerRef.current?.querySelector(
        `[data-edit-container][data-message-id="${editingMessageId}"]`
      ) as HTMLElement | null
      if (editContainer?.contains(target)) {
        return
      }
      cancelEditCallbackRef.current?.()
    },
    [isEditingMessage, editingMessageId]
  )

  /** Creates a new chat session and focuses the input */
  const handleStartNewChat = useCallback(() => {
    createNewChat()
    logger.info('Started new chat')

    setTimeout(() => {
      userInputRef.current?.focus()
    }, 100)
  }, [createNewChat])

  /** Sets the input value and focuses the textarea */
  const handleSetInputValueAndFocus = useCallback(
    (value: string) => {
      setInputValue(value)
      setTimeout(() => {
        userInputRef.current?.focus()
      }, 150)
    },
    [setInputValue]
  )

  /** Exposes imperative functions to parent */
  useImperativeHandle(
    ref,
    () => ({
      createNewChat: handleStartNewChat,
      setInputValueAndFocus: handleSetInputValueAndFocus,
      focusInput,
    }),
    [handleStartNewChat, handleSetInputValueAndFocus, focusInput]
  )

  /** Aborts current message streaming and collapses todos if shown */
  const handleAbort = useCallback(() => {
    abortMessage()
    if (showPlanTodos) {
      setTodosCollapsed(true)
    }
  }, [abortMessage, showPlanTodos])

  /** Closes the plan todos section and clears the todos */
  const handleClosePlanTodos = useCallback(() => {
    closePlanTodos()
    setPlanTodos([])
  }, [closePlanTodos, setPlanTodos])

  /** Handles message submission to the copilot */
  const handleSubmit = useCallback(
    async (query: string, fileAttachments?: MessageFileAttachment[], contexts?: ChatContext[]) => {
      // Allow submission even when isSendingMessage - store will queue the message
      if (!query || !activeWorkflowId) return

      if (showPlanTodos) {
        setPlanTodos([])
      }

      try {
        await sendMessage(query, { stream: true, fileAttachments, contexts })
        logger.info(
          'Sent message:',
          query,
          fileAttachments ? `with ${fileAttachments.length} attachments` : ''
        )
      } catch (error) {
        logger.error('Failed to send message:', error)
      }
    },
    [activeWorkflowId, sendMessage, showPlanTodos, setPlanTodos]
  )

  /** Handles message edit mode changes */
  const handleEditModeChange = useCallback(
    (messageId: string, isEditing: boolean, cancelCallback?: () => void) => {
      setEditingMessageId(isEditing ? messageId : null)
      cancelEditCallbackRef.current = isEditing ? cancelCallback || null : null
      logger.info('Edit mode changed', { messageId, isEditing, willDimMessages: isEditing })
    },
    []
  )

  /** Handles checkpoint revert mode changes */
  const handleRevertModeChange = useCallback((messageId: string, isReverting: boolean) => {
    setRevertingMessageId(isReverting ? messageId : null)
  }, [])

  /** Handles chat deletion */
  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      try {
        await deleteChat(chatId)
      } catch (error) {
        logger.error('Error deleting chat:', error)
      }
    },
    [deleteChat]
  )

  /** Handles history dropdown opening state, loads chats if needed (non-blocking) */
  const handleHistoryDropdownOpen = useCallback(
    (open: boolean) => {
      setIsHistoryDropdownOpen(open)
      handleHistoryDropdownOpenHook(open)
    },
    [handleHistoryDropdownOpenHook]
  )

  return (
    <>
      <div
        ref={copilotContainerRef}
        onClickCapture={handleCopilotClickCapture}
        className='flex h-full flex-col overflow-hidden'
      >
        {/* Header */}
        <div className='mx-[-1px] flex flex-shrink-0 items-center justify-between gap-[8px] rounded-[4px] border border-[var(--border)] bg-[var(--surface-4)] px-[12px] py-[6px]'>
          <h2 className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
            {currentChat?.title || 'New Chat'}
          </h2>
          <div className='flex items-center gap-[8px]'>
            <Button variant='ghost' className='p-0' onClick={handleStartNewChat}>
              <Plus className='h-[14px] w-[14px]' />
            </Button>
            <Popover open={isHistoryDropdownOpen} onOpenChange={handleHistoryDropdownOpen}>
              <PopoverTrigger asChild>
                <Button variant='ghost' className='p-0'>
                  <History className='h-[14px] w-[14px]' />
                </Button>
              </PopoverTrigger>
              <PopoverContent align='end' side='bottom' sideOffset={8} maxHeight={280}>
                {isLoadingChats ? (
                  <PopoverScrollArea>
                    <ChatHistorySkeleton />
                  </PopoverScrollArea>
                ) : groupedChats.length === 0 ? (
                  <div className='px-[6px] py-[16px] text-center text-[12px] text-muted-foreground'>
                    No chats yet
                  </div>
                ) : (
                  <PopoverScrollArea>
                    {groupedChats.map(([groupName, chatsInGroup], groupIndex) => (
                      <div key={groupName}>
                        <PopoverSection className={groupIndex === 0 ? 'pt-0' : ''}>
                          {groupName}
                        </PopoverSection>
                        <div className='flex flex-col gap-0.5'>
                          {chatsInGroup.map((chat) => (
                            <div key={chat.id} className='group'>
                              <PopoverItem
                                active={currentChat?.id === chat.id}
                                onClick={() => {
                                  if (currentChat?.id !== chat.id) {
                                    selectChat(chat)
                                  }
                                  setIsHistoryDropdownOpen(false)
                                }}
                              >
                                <span className='min-w-0 flex-1 truncate'>
                                  {chat.title || 'New Chat'}
                                </span>
                                <div
                                  className={cn(
                                    'flex flex-shrink-0 items-center gap-[4px]',
                                    currentChat?.id !== chat.id &&
                                      'opacity-0 transition-opacity group-hover:opacity-100'
                                  )}
                                >
                                  <Button
                                    variant='ghost'
                                    className='h-[16px] w-[16px] p-0'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteChat(chat.id)
                                    }}
                                    aria-label='Delete chat'
                                  >
                                    <Trash className='h-[10px] w-[10px]' />
                                  </Button>
                                </div>
                              </PopoverItem>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </PopoverScrollArea>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Show loading state until fully initialized */}
        {!isInitialized ? (
          <div className='flex h-full w-full items-center justify-center'>
            <div className='flex flex-col items-center gap-3'>
              <p className='text-muted-foreground text-sm'>Loading copilot</p>
            </div>
          </div>
        ) : (
          <>
            {/* Messages area */}
            {messages.length === 0 && !isSendingMessage && !isEditingMessage ? (
              /* Welcome state with input at top */
              <div className='flex flex-1 flex-col overflow-hidden p-[8px]'>
                <div className='flex-shrink-0'>
                  <UserInput
                    ref={userInputRef}
                    onSubmit={handleSubmit}
                    onAbort={handleAbort}
                    disabled={!activeWorkflowId}
                    isLoading={isSendingMessage}
                    isAborting={isAborting}
                    mode={mode}
                    onModeChange={setMode}
                    value={inputValue}
                    onChange={setInputValue}
                    panelWidth={panelWidth}
                    hasPlanArtifact={Boolean(designDocumentContent)}
                  />
                </div>
                <div className='flex-shrink-0 pt-[8px]'>
                  <Welcome onQuestionClick={handleSubmit} mode={mode} />
                </div>
              </div>
            ) : (
              /* Normal messages view */
              <div className='relative flex flex-1 flex-col overflow-hidden'>
                {/* Design Document Section - Pinned at top, shown in all modes when available */}
                {designDocumentContent && (
                  <div className='flex-shrink-0 px-[8px] pt-[8px]'>
                    <PlanModeSection
                      content={designDocumentContent}
                      onClear={clearPlanArtifact}
                      onSave={savePlanArtifact}
                    />
                  </div>
                )}

                <div className='relative flex-1 overflow-hidden'>
                  <div
                    ref={scrollAreaRef}
                    className='h-full overflow-y-auto overflow-x-hidden px-[8px]'
                  >
                    <div
                      className={`w-full max-w-full space-y-[8px] overflow-hidden py-[8px] ${
                        showPlanTodos && planTodos.length > 0 ? 'pb-14' : 'pb-10'
                      }`}
                    >
                      {messages.map((message, index) => {
                        let isDimmed = false

                        if (editingMessageId) {
                          const editingIndex = messages.findIndex((m) => m.id === editingMessageId)
                          isDimmed = editingIndex !== -1 && index > editingIndex
                        }

                        if (!isDimmed && revertingMessageId) {
                          const revertingIndex = messages.findIndex(
                            (m) => m.id === revertingMessageId
                          )
                          isDimmed = revertingIndex !== -1 && index > revertingIndex
                        }

                        const checkpointCount = messageCheckpoints[message.id]?.length || 0

                        return (
                          <CopilotMessage
                            key={message.id}
                            message={message}
                            isStreaming={
                              isSendingMessage && message.id === messages[messages.length - 1]?.id
                            }
                            panelWidth={panelWidth}
                            isDimmed={isDimmed}
                            checkpointCount={checkpointCount}
                            onEditModeChange={(isEditing, cancelCallback) =>
                              handleEditModeChange(message.id, isEditing, cancelCallback)
                            }
                            onRevertModeChange={(isReverting) =>
                              handleRevertModeChange(message.id, isReverting)
                            }
                            isLastMessage={index === messages.length - 1}
                          />
                        )
                      })}
                    </div>
                  </div>

                  {/* Todo list from plan tool - overlay at bottom so it's not clipped by scroll area */}
                  {showPlanTodos && planTodos.length > 0 && (
                    <div
                      className='-translate-x-1/2 absolute bottom-0 left-1/2 z-[2] w-full max-w-full px-[8px]'
                      style={{ maxWidth: `${panelWidth - 18}px` } as React.CSSProperties}
                    >
                      <TodoList
                        todos={planTodos}
                        collapsed={todosCollapsed}
                        onClose={handleClosePlanTodos}
                      />
                    </div>
                  )}
                </div>

                {/* Queued messages (shown when messages are waiting) */}
                <QueuedMessages />

                {/* Input area with integrated mode selector */}
                <div className='flex-shrink-0 px-[8px] pb-[8px]'>
                  <UserInput
                    ref={userInputRef}
                    onSubmit={handleSubmit}
                    onAbort={handleAbort}
                    disabled={!activeWorkflowId}
                    isLoading={isSendingMessage}
                    isAborting={isAborting}
                    mode={mode}
                    onModeChange={setMode}
                    value={inputValue}
                    onChange={setInputValue}
                    panelWidth={panelWidth}
                    hasPlanArtifact={Boolean(designDocumentContent)}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
})

Copilot.displayName = 'Copilot'
