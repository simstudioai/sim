'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console/logger'
import {
  CheckpointPanel,
  CopilotMessage,
  CopilotWelcome,
  TodoList,
  UserInput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components'
import type {
  MessageFileAttachment,
  UserInputRef,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/user-input'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { useCopilotStore } from '@/stores/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Copilot')

interface CopilotProps {
  panelWidth: number
}

interface CopilotRef {
  createNewChat: () => void
  setInputValueAndFocus: (value: string) => void
}

export const Copilot = forwardRef<CopilotRef, CopilotProps>(({ panelWidth }, ref) => {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const userInputRef = useRef<UserInputRef>(null)
  const [showCheckpoints] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [todosCollapsed, setTodosCollapsed] = useState(false)
  const lastWorkflowIdRef = useRef<string | null>(null)
  const hasMountedRef = useRef(false)

  // Scroll state
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  // New state to track if user has intentionally scrolled during streaming
  const [userHasScrolledDuringStream, setUserHasScrolledDuringStream] = useState(false)
  const isUserScrollingRef = useRef(false) // Track if scroll event is user-initiated

  const { activeWorkflowId } = useWorkflowRegistry()

  // Use preview store to track seen previews
  const { isToolCallSeen, markToolCallAsSeen } = usePreviewStore()

  // Use the new copilot store
  const {
    messages,
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
  } = useCopilotStore()

  // Force fresh initialization on mount (handles hot reload)
  useEffect(() => {
    if (activeWorkflowId && !hasMountedRef.current) {
      hasMountedRef.current = true
      // Reset state to ensure fresh load, especially important for hot reload
      setIsInitialized(false)
      lastWorkflowIdRef.current = null

      // Force reload chats for current workflow
      setCopilotWorkflowId(activeWorkflowId)
      loadChats(true) // Force refresh
    }
  }, [activeWorkflowId, setCopilotWorkflowId, loadChats])

  // Initialize the component - only on mount and genuine workflow changes
  useEffect(() => {
    // If workflow actually changed (not initial mount), reset initialization
    if (
      activeWorkflowId &&
      activeWorkflowId !== lastWorkflowIdRef.current &&
      hasMountedRef.current
    ) {
      setIsInitialized(false)
      lastWorkflowIdRef.current = activeWorkflowId
    }

    // Set as initialized once we have the workflow and chats are ready
    if (
      activeWorkflowId &&
      !isLoadingChats &&
      chatsLoadedForWorkflow === activeWorkflowId &&
      !isInitialized
    ) {
      setIsInitialized(true)
    }
  }, [activeWorkflowId, isLoadingChats, chatsLoadedForWorkflow, isInitialized])

  // Clear any existing preview when component mounts or workflow changes
  useEffect(() => {
    // Preview clearing is now handled automatically by the copilot store
  }, [activeWorkflowId])

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (scrollContainer) {
        // Mark that we're programmatically scrolling
        isUserScrollingRef.current = false
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }
    }
  }, [])

  // Handle scroll events to track user position
  const handleScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Find the viewport element inside the ScrollArea
    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    // Consider "near bottom" if within 100px of bottom
    const nearBottom = distanceFromBottom <= 100
    setIsNearBottom(nearBottom)
    setShowScrollButton(!nearBottom)

    // If user scrolled up during streaming, mark it
    if (isSendingMessage && !nearBottom && isUserScrollingRef.current) {
      setUserHasScrolledDuringStream(true)
    }

    // Reset the user scrolling flag after processing
    isUserScrollingRef.current = true
  }, [isSendingMessage])

  // Attach scroll listener
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    // Find the viewport element inside the ScrollArea
    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    // Mark user-initiated scrolls
    const handleUserScroll = () => {
      isUserScrollingRef.current = true
      handleScroll()
    }

    viewport.addEventListener('scroll', handleUserScroll, { passive: true })

    // Also listen for scrollend event if available (for smooth scrolling)
    if ('onscrollend' in viewport) {
      viewport.addEventListener('scrollend', handleScroll, { passive: true })
    }

    // Initial scroll state check with small delay to ensure DOM is ready
    setTimeout(handleScroll, 100)

    return () => {
      viewport.removeEventListener('scroll', handleUserScroll)
      if ('onscrollend' in viewport) {
        viewport.removeEventListener('scrollend', handleScroll)
      }
    }
  }, [handleScroll])

  // Smart auto-scroll: only scroll if user hasn't intentionally scrolled up during streaming
  useEffect(() => {
    if (messages.length === 0) return

    const lastMessage = messages[messages.length - 1]
    const isNewUserMessage = lastMessage?.role === 'user'

    // Conditions for auto-scrolling:
    // 1. Always scroll for new user messages (resets the user scroll state)
    // 2. For assistant messages during streaming: only if user hasn't scrolled up
    // 3. For assistant messages when not streaming: only if near bottom
    const shouldAutoScroll =
      isNewUserMessage ||
      (isSendingMessage && !userHasScrolledDuringStream) ||
      (!isSendingMessage && isNearBottom)

    if (shouldAutoScroll && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (scrollContainer) {
        // Mark that we're programmatically scrolling
        isUserScrollingRef.current = false
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }
    }
  }, [messages, isNearBottom, isSendingMessage, userHasScrolledDuringStream])

  // Reset user scroll state when streaming starts or when user sends a message
  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === 'user') {
      // User sent a new message - reset scroll state
      setUserHasScrolledDuringStream(false)
      isUserScrollingRef.current = false
    }
  }, [messages])

  // Reset user scroll state when streaming completes
  const prevIsSendingRef = useRef(false)
  useEffect(() => {
    // When streaming transitions from true to false, reset the user scroll state
    if (prevIsSendingRef.current && !isSendingMessage) {
      setUserHasScrolledDuringStream(false)
    }
    prevIsSendingRef.current = isSendingMessage
  }, [isSendingMessage])

  // Auto-scroll to bottom when chat loads in
  useEffect(() => {
    if (isInitialized && messages.length > 0) {
      scrollToBottom()
    }
  }, [isInitialized, messages.length, scrollToBottom])

  // Track previous sending state to detect when stream completes
  const wasSendingRef = useRef(false)

  // Auto-collapse todos and remove uncompleted ones when stream completes
  useEffect(() => {
    if (wasSendingRef.current && !isSendingMessage && showPlanTodos) {
      // Stream just completed, collapse the todos and filter out uncompleted ones
      setTodosCollapsed(true)

      // Remove any uncompleted todos
      const completedTodos = planTodos.filter((todo) => todo.completed === true)
      if (completedTodos.length !== planTodos.length) {
        // Only update if there are uncompleted todos to remove
        const store = useCopilotStore.getState()
        store.setPlanTodos(completedTodos)
      }
    }
    wasSendingRef.current = isSendingMessage
  }, [isSendingMessage, showPlanTodos, planTodos])

  // Reset collapsed state when todos first appear
  useEffect(() => {
    if (showPlanTodos && planTodos.length > 0) {
      // Check if this is the first time todos are showing
      // (only expand if currently sending a message, meaning new todos are being created)
      if (isSendingMessage) {
        setTodosCollapsed(false)
      }
    }
  }, [showPlanTodos, planTodos.length, isSendingMessage])

  // Cleanup on component unmount (page refresh, navigation, etc.)
  useEffect(() => {
    return () => {
      // Abort any active message streaming and terminate active tools
      if (isSendingMessage) {
        abortMessage()
        logger.info('Aborted active message streaming due to component unmount')
      }
    }
  }, [isSendingMessage, abortMessage])

  // Handle new chat creation
  const handleStartNewChat = useCallback(() => {
    // Preview clearing is now handled automatically by the copilot store
    createNewChat()
    logger.info('Started new chat')

    // Focus the input after creating new chat
    setTimeout(() => {
      userInputRef.current?.focus()
    }, 100) // Small delay to ensure DOM updates are complete
  }, [createNewChat])

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

  // Handle abort action
  const handleAbort = useCallback(() => {
    abortMessage()
    // Collapse todos when aborting
    if (showPlanTodos) {
      setTodosCollapsed(true)
    }
  }, [abortMessage, showPlanTodos])

  // Handle message submission
  const handleSubmit = useCallback(
    async (query: string, fileAttachments?: MessageFileAttachment[], contexts?: any[]) => {
      if (!query || isSendingMessage || !activeWorkflowId) return

      // Clear todos when sending a new message
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

  return (
    <>
      <div className='flex h-full flex-col overflow-hidden'>
        {/* Show loading state until fully initialized */}
        {!isInitialized ? (
          <div className='flex h-full w-full items-center justify-center'>
            <div className='flex flex-col items-center gap-3'>
              <LoadingAgent size='md' />
              <p className='text-muted-foreground text-sm'>Loading chat history...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Messages area or Checkpoint Panel */}
            {showCheckpoints ? (
              <CheckpointPanel />
            ) : (
              <div className='relative flex-1 overflow-hidden'>
                <ScrollArea ref={scrollAreaRef} className='h-full' hideScrollbar={true}>
                  <div className='w-full max-w-full space-y-1 overflow-hidden'>
                    {messages.length === 0 ? (
                      <div className='flex h-full items-center justify-center p-4'>
                        <CopilotWelcome
                          onQuestionClick={handleSubmit}
                          mode={mode === 'ask' ? 'ask' : 'agent'}
                        />
                      </div>
                    ) : (
                      messages.map((message) => (
                        <CopilotMessage
                          key={message.id}
                          message={message}
                          isStreaming={
                            isSendingMessage && message.id === messages[messages.length - 1]?.id
                          }
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>

                {/* Scroll to bottom button */}
                {showScrollButton && (
                  <div className='-translate-x-1/2 absolute bottom-4 left-1/2 z-10'>
                    <Button
                      onClick={scrollToBottom}
                      size='sm'
                      variant='outline'
                      className='flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 shadow-lg transition-all hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700'
                    >
                      <ArrowDown className='h-3.5 w-3.5 text-gray-700 dark:text-gray-300' />
                      <span className='sr-only'>Scroll to bottom</span>
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Todo list from plan tool */}
            {!showCheckpoints && showPlanTodos && (
              <TodoList
                todos={planTodos}
                collapsed={todosCollapsed}
                onClose={() => {
                  const store = useCopilotStore.getState()
                  store.setPlanTodos([])
                }}
              />
            )}

            {/* Input area with integrated mode selector */}
            {!showCheckpoints && (
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
            )}
          </>
        )}
      </div>
    </>
  )
})

Copilot.displayName = 'Copilot'
