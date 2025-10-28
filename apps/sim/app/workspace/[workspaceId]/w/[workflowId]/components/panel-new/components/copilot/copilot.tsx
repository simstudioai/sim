'use client'

import type { MouseEvent as ReactMouseEvent } from 'react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { History, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button as EmcnButton } from '@/components/emcn'
// Button import removed; no longer used after removing jump-to-bottom
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console/logger'
import {
  CheckpointPanel,
  CopilotMessage,
  TodoList,
  UserInput,
  Welcome,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components'
import type { MessageFileAttachment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/user-input/hooks/use-file-attachments'
import type { UserInputRef } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/user-input/user-input'
import { usePreviewStore } from '@/stores/panel-new/copilot/preview-store'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  useChatHistory,
  useCopilotInitialization,
  useScrollManagement,
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
  const [showCheckpoints] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [isEditingMessage, setIsEditingMessage] = useState(false)
  const [revertingMessageId, setRevertingMessageId] = useState<string | null>(null)
  const [isHistoryDropdownOpen, setIsHistoryDropdownOpen] = useState(false)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingChatTitle, setEditingChatTitle] = useState<string>('')

  const { activeWorkflowId } = useWorkflowRegistry()
  const { isToolCallSeen, markToolCallAsSeen } = usePreviewStore()

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
    enabledModels,
    setEnabledModels,
    selectedModel,
    setSelectedModel,
    messageCheckpoints,
    currentChat,
    fetchContextUsage,
    selectChat,
    deleteChat,
    areChatsFresh,
    workflowId: copilotWorkflowId,
    setPlanTodos,
  } = useCopilotStore()

  // Initialize copilot and load models
  const { isInitialized } = useCopilotInitialization({
    activeWorkflowId,
    isLoadingChats,
    chatsLoadedForWorkflow,
    setCopilotWorkflowId,
    loadChats,
    setEnabledModels,
    enabledModels,
    selectedModel,
    setSelectedModel,
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
    <div className='px-1 py-1'>
      <div className='border-[#E5E5E5] border-t-0 px-1 pt-1 pb-0.5 dark:border-[#414141]'>
        <div className='h-3 w-12 animate-pulse rounded bg-muted/40' />
      </div>
      <div className='mt-1 flex flex-col gap-1'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='mx-1 flex h-8 items-center rounded-lg px-2 py-1.5'>
            <div className='h-3 w-full animate-pulse rounded bg-muted/40' />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <div
        ref={copilotContainerRef}
        onClickCapture={handleCopilotClickCapture}
        className='flex h-full flex-col overflow-hidden bg-[#232323] dark:bg-[#232323]'
      >
        {/* Header */}
        <div className='flex flex-shrink-0 items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px] dark:bg-[#2A2A2A]'>
          <h2 className='font-medium text-[#FFFFFF] text-[14px] dark:text-[#FFFFFF]'>Copilot</h2>
          <div className='flex items-center gap-[8px]'>
            <EmcnButton variant='ghost' className='p-0' onClick={handleStartNewChat}>
              <Plus className='h-[14px] w-[14px]' />
            </EmcnButton>
            <DropdownMenu open={isHistoryDropdownOpen} onOpenChange={handleHistoryDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <EmcnButton variant='ghost' className='p-0'>
                  <History className='h-[14px] w-[14px]' />
                </EmcnButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                className='z-[200] w-96 rounded-lg border bg-background p-2 shadow-lg dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
                sideOffset={8}
                side='bottom'
                avoidCollisions={true}
                collisionPadding={8}
              >
                {isLoadingChats ? (
                  <div className='max-h-[280px] overflow-y-auto'>
                    <ChatHistorySkeleton />
                  </div>
                ) : groupedChats.length === 0 ? (
                  <div className='px-2 py-6 text-center text-muted-foreground text-sm'>
                    No chats yet
                  </div>
                ) : (
                  <div className='max-h-[280px] overflow-y-auto'>
                    {groupedChats.map(([groupName, chatsInGroup], groupIndex) => (
                      <div key={groupName}>
                        <div
                          className={`px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide ${groupIndex === 0 ? 'pt-0' : ''}`}
                        >
                          {groupName}
                        </div>
                        <div className='flex flex-col gap-0.5'>
                          {chatsInGroup.map((chat) => (
                            <div
                              key={chat.id}
                              className={`group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                                currentChat?.id === chat.id
                                  ? 'bg-accent text-accent-foreground'
                                  : 'text-foreground hover:bg-accent/50'
                              }`}
                            >
                              {editingChatId === chat.id ? (
                                <input
                                  type='text'
                                  value={editingChatTitle}
                                  onChange={(e) => setEditingChatTitle(e.target.value)}
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      const newTitle = editingChatTitle.trim() || 'Untitled Chat'

                                      const updatedChats = chats.map((c) =>
                                        c.id === chat.id ? { ...c, title: newTitle } : c
                                      )
                                      useCopilotStore.setState({ chats: updatedChats })
                                      setEditingChatId(null)

                                      try {
                                        await fetch('/api/copilot/chat/update-title', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            chatId: chat.id,
                                            title: newTitle,
                                          }),
                                        })
                                      } catch (error) {
                                        logger.error('Failed to update chat title:', error)
                                        await loadChats(true)
                                      }
                                    } else if (e.key === 'Escape') {
                                      setEditingChatId(null)
                                    }
                                  }}
                                  onBlur={() => setEditingChatId(null)}
                                  className='min-w-0 flex-1 rounded border-none bg-transparent px-0 text-sm outline-none focus:outline-none'
                                />
                              ) : (
                                <>
                                  <span
                                    onClick={() => {
                                      if (currentChat?.id !== chat.id) {
                                        selectChat(chat)
                                      }
                                      setIsHistoryDropdownOpen(false)
                                    }}
                                    className='min-w-0 cursor-pointer truncate text-sm'
                                    style={{ maxWidth: 'calc(100% - 60px)' }}
                                  >
                                    {chat.title || 'Untitled Chat'}
                                  </span>
                                  <div className='ml-auto flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setEditingChatId(chat.id)
                                        setEditingChatTitle(chat.title || 'Untitled Chat')
                                      }}
                                      className='flex h-5 w-5 items-center justify-center rounded hover:bg-muted'
                                      aria-label='Edit chat title'
                                    >
                                      <Pencil className='h-3 w-3' />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (
                                          window.confirm(
                                            'Are you sure you want to delete this chat?'
                                          )
                                        ) {
                                          handleDeleteChat(chat.id)
                                        }
                                      }}
                                      className='flex h-5 w-5 items-center justify-center rounded hover:bg-muted'
                                      aria-label='Delete chat'
                                    >
                                      <Trash2 className='h-3 w-3' />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
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
            {/* Messages area or Checkpoint Panel */}
            {showCheckpoints ? (
              <CheckpointPanel />
            ) : messages.length === 0 && !isSendingMessage && !isEditingMessage ? (
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
                  <Welcome onQuestionClick={handleSubmit} mode={mode === 'ask' ? 'ask' : 'agent'} />
                </div>
              </div>
            ) : (
              /* Normal messages view */
              <div className='relative flex flex-1 flex-col overflow-hidden'>
                <div className='relative flex-1 overflow-hidden'>
                  <div
                    ref={scrollAreaRef}
                    className='copilot-scrollable h-full overflow-y-auto overflow-x-hidden px-[8px]'
                  >
                    <div className='w-full max-w-full space-y-4 overflow-hidden py-[8px] pb-10'>
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

                  {/* Todo list from plan tool */}
                  {showPlanTodos && (
                    <TodoList
                      todos={planTodos}
                      collapsed={todosCollapsed}
                      onClose={() => {
                        const store = useCopilotStore.getState()
                        store.setPlanTodos([])
                      }}
                    />
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
