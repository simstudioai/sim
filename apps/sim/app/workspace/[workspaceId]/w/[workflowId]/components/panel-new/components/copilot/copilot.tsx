'use client'

import type { MouseEvent as ReactMouseEvent } from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
import { createLogger } from '@/lib/logs/console/logger'
import {
  CopilotMessage,
  TodoList,
  UserInput,
  Welcome,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components'
import type { MessageFileAttachment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/user-input/hooks/use-file-attachments'
import type { UserInputRef } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/user-input/user-input'
import { useScrollManagement } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  useChatHistory,
  useCopilotInitialization,
  useLandingPrompt,
  useTodoManagement,
} from './hooks'

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
  const [isEditingMessage, setIsEditingMessage] = useState(false)
  const [revertingMessageId, setRevertingMessageId] = useState<string | null>(null)
  const [isHistoryDropdownOpen, setIsHistoryDropdownOpen] = useState(false)

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
    fetchContextUsage,
    selectChat,
    deleteChat,
    areChatsFresh,
    workflowId: copilotWorkflowId,
    setPlanTodos,
  } = useCopilotStore()

  // Initialize copilot
  const { isInitialized } = useCopilotInitialization({
    activeWorkflowId,
    isLoadingChats,
    chatsLoadedForWorkflow,
    setCopilotWorkflowId,
    loadChats,
    fetchContextUsage,
    currentChat,
    isSendingMessage,
  })

  // Handle scroll management
  const { scrollAreaRef, scrollToBottom } = useScrollManagement(messages, isSendingMessage)

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
    setPlanTodos,
  })

  /**
   * Helper function to focus the copilot input
   */
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

  /**
   * Auto-scroll to bottom when chat loads in
   */
  useEffect(() => {
    if (isInitialized && messages.length > 0) {
      scrollToBottom()
    }
  }, [isInitialized, messages.length, scrollToBottom])

  /**
   * Cleanup on component unmount (page refresh, navigation, etc.)
   */
  useEffect(() => {
    return () => {
      if (isSendingMessage) {
        abortMessage()
        logger.info('Aborted active message streaming due to component unmount')
      }
    }
  }, [isSendingMessage, abortMessage])

  /**
   * Container-level click capture to cancel edit mode when clicking outside the current edit area
   */
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

  /**
   * Handles creating a new chat session
   * Focuses the input after creation
   */
  const handleStartNewChat = useCallback(() => {
    createNewChat()
    logger.info('Started new chat')

    setTimeout(() => {
      userInputRef.current?.focus()
    }, 100)
  }, [createNewChat])

  /**
   * Sets the input value and focuses the textarea
   * @param value - The value to set in the input
   */
  const handleSetInputValueAndFocus = useCallback(
    (value: string) => {
      setInputValue(value)
      setTimeout(() => {
        userInputRef.current?.focus()
      }, 150)
    },
    [setInputValue]
  )

  // Expose functions to parent
  useImperativeHandle(
    ref,
    () => ({
      createNewChat: handleStartNewChat,
      setInputValueAndFocus: handleSetInputValueAndFocus,
    }),
    [handleStartNewChat, handleSetInputValueAndFocus]
  )

  /**
   * Handles aborting the current message streaming
   * Collapses todos if they are currently shown
   */
  const handleAbort = useCallback(() => {
    abortMessage()
    if (showPlanTodos) {
      setTodosCollapsed(true)
    }
  }, [abortMessage, showPlanTodos])

  /**
   * Handles message submission to the copilot
   * @param query - The message text to send
   * @param fileAttachments - Optional file attachments
   * @param contexts - Optional context references
   */
  const handleSubmit = useCallback(
    async (query: string, fileAttachments?: MessageFileAttachment[], contexts?: any[]) => {
      if (!query || isSendingMessage || !activeWorkflowId) return

      if (showPlanTodos) {
        const store = useCopilotStore.getState()
        store.setPlanTodos([])
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
    [isSendingMessage, activeWorkflowId, sendMessage, showPlanTodos]
  )

  /**
   * Handles message edit mode changes
   * @param messageId - ID of the message being edited
   * @param isEditing - Whether edit mode is active
   */
  const handleEditModeChange = useCallback(
    (messageId: string, isEditing: boolean, cancelCallback?: () => void) => {
      setEditingMessageId(isEditing ? messageId : null)
      setIsEditingMessage(isEditing)
      cancelEditCallbackRef.current = isEditing ? cancelCallback || null : null
      logger.info('Edit mode changed', { messageId, isEditing, willDimMessages: isEditing })
    },
    []
  )

  /**
   * Handles checkpoint revert mode changes
   * @param messageId - ID of the message being reverted
   * @param isReverting - Whether revert mode is active
   */
  const handleRevertModeChange = useCallback((messageId: string, isReverting: boolean) => {
    setRevertingMessageId(isReverting ? messageId : null)
  }, [])

  /**
   * Handles chat deletion
   * @param chatId - ID of the chat to delete
   */
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

  /**
   * Handles history dropdown opening state
   * Loads chats if needed when dropdown opens (non-blocking)
   * @param open - Whether the dropdown is open
   */
  const handleHistoryDropdownOpen = useCallback(
    (open: boolean) => {
      setIsHistoryDropdownOpen(open)
      // Fire hook without awaiting - prevents blocking and state issues
      handleHistoryDropdownOpenHook(open)
    },
    [handleHistoryDropdownOpenHook]
  )

  /**
   * Skeleton loading component for chat history
   */
  const ChatHistorySkeleton = () => (
    <>
      <PopoverSection>
        <div className='h-3 w-12 animate-pulse rounded bg-muted/40' />
      </PopoverSection>
      <div className='flex flex-col gap-0.5'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='flex h-[25px] items-center px-[6px]'>
            <div className='h-3 w-full animate-pulse rounded bg-muted/40' />
          </div>
        ))}
      </div>
    </>
  )

  return (
    <>
      <div
        ref={copilotContainerRef}
        onClickCapture={handleCopilotClickCapture}
        className='flex h-full flex-col overflow-hidden'
      >
        {/* Header */}
        <div className='flex flex-shrink-0 items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px] dark:bg-[#2A2A2A]'>
          <h2 className='font-medium text-[14px] text-[var(--white)] dark:text-[var(--white)]'>
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
                  <div className='px-[6px] py-[16px] text-center text-[12px] text-[var(--white)] dark:text-[var(--white)]'>
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
                                <div className='flex flex-shrink-0 items-center gap-[4px] opacity-0 transition-opacity group-hover:opacity-100'>
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
              <p className='text-muted-foreground text-sm'>Loading chat history...</p>
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
                  />
                </div>
                <div className='flex-shrink-0 pt-[8px]'>
                  <Welcome onQuestionClick={handleSubmit} mode={mode === 'ask' ? 'ask' : 'build'} />
                </div>
              </div>
            ) : (
              /* Normal messages view */
              <div className='relative flex flex-1 flex-col overflow-hidden'>
                <div className='relative flex-1 overflow-hidden'>
                  <div
                    ref={scrollAreaRef}
                    className='h-full overflow-y-auto overflow-x-hidden px-[8px]'
                  >
                    <div
                      className={`w-full max-w-full space-y-4 overflow-hidden py-[8px] ${
                        showPlanTodos && planTodos.length > 0 ? 'pb-14' : 'pb-10'
                      }`}
                    >
                      {messages.map((message, index) => {
                        // Determine if this message should be dimmed
                        let isDimmed = false

                        // Dim messages after the one being edited
                        if (editingMessageId) {
                          const editingIndex = messages.findIndex((m) => m.id === editingMessageId)
                          isDimmed = editingIndex !== -1 && index > editingIndex
                        }

                        // Also dim messages after the one showing restore confirmation
                        if (!isDimmed && revertingMessageId) {
                          const revertingIndex = messages.findIndex(
                            (m) => m.id === revertingMessageId
                          )
                          isDimmed = revertingIndex !== -1 && index > revertingIndex
                        }

                        // Get checkpoint count for this message to force re-render when it changes
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
                        onClose={() => {
                          const store = useCopilotStore.getState()
                          store.closePlanTodos?.()
                          useCopilotStore.setState({ planTodos: [] })
                        }}
                      />
                    </div>
                  )}
                </div>

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
