'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console/logger'
import { COPILOT_TOOL_IDS } from '@/stores/copilot/constants'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { useCopilotStore } from '@/stores/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { CheckpointPanel } from './components/checkpoint-panel'
import { ProfessionalInput } from './components/professional-input/professional-input'
import { ProfessionalMessage } from './components/professional-message/professional-message'
import { CopilotWelcome } from './components/welcome/welcome'

const logger = createLogger('Copilot')

interface CopilotProps {
  panelWidth: number
}

interface CopilotRef {
  createNewChat: () => void
}

export const Copilot = forwardRef<CopilotRef, CopilotProps>(({ panelWidth }, ref) => {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [showCheckpoints, setShowCheckpoints] = useState(false)
  const scannedChatRef = useRef<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const lastWorkflowIdRef = useRef<string | null>(null)
  const hasMountedRef = useRef(false)

  const { activeWorkflowId } = useWorkflowRegistry()

  // Use preview store to track seen previews
  const { scanAndMarkExistingPreviews, isToolCallSeen, markToolCallAsSeen } = usePreviewStore()

  // Use the new copilot store
  const {
    messages,
    isLoading,
    isLoadingChats,
    isSendingMessage,
    isAborting,
    mode,
    inputValue,
    sendMessage,
    abortMessage,
    createNewChat,
    clearMessages,
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

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages])

  // Auto-scroll to bottom when chat loads in
  useEffect(() => {
    if (isInitialized && messages.length > 0 && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [isInitialized, messages.length])

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

  // Watch for completed preview_workflow tool calls in the new format
  useEffect(() => {
    if (!messages.length) return

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== 'assistant' || !lastMessage.toolCalls) return

    // Check for completed preview_workflow tool calls
    const previewToolCall = lastMessage.toolCalls.find(
      (tc) =>
        tc.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW &&
        tc.state === 'completed' &&
        !isToolCallSeen(tc.id)
    )

    if (previewToolCall?.result) {
      logger.info('Preview workflow completed via native SSE - handling result')
      // Mark as seen to prevent duplicate processing
      markToolCallAsSeen(previewToolCall.id)
      // Tool call handling logic would go here if needed
    }
  }, [messages, isToolCallSeen, markToolCallAsSeen])

  // Handle new chat creation
  const handleStartNewChat = useCallback(() => {
    // Preview clearing is now handled automatically by the copilot store
    createNewChat()
    logger.info('Started new chat')
  }, [createNewChat])

  // Expose functions to parent
  useImperativeHandle(
    ref,
    () => ({
      createNewChat: handleStartNewChat,
    }),
    [handleStartNewChat]
  )

  // Handle message submission
  const handleSubmit = useCallback(
    async (query: string) => {
      if (!query || isSendingMessage || !activeWorkflowId) return

      try {
        await sendMessage(query, { stream: true })
        logger.info('Sent message:', query)
      } catch (error) {
        logger.error('Failed to send message:', error)
      }
    },
    [isSendingMessage, activeWorkflowId, sendMessage]
  )

  // Handle modal message sending
  const handleModalSendMessage = useCallback(
    async (message: string) => {
      await handleSubmit(message)
    },
    [handleSubmit]
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
              <ScrollArea
                ref={scrollAreaRef}
                className='flex-1 overflow-hidden'
                hideScrollbar={true}
              >
                <div className='space-y-1'>
                  {messages.length === 0 ? (
                    <div className='flex h-full items-center justify-center p-4'>
                      <CopilotWelcome onQuestionClick={handleSubmit} mode={mode} />
                    </div>
                  ) : (
                    messages.map((message) => (
                      <ProfessionalMessage
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
            )}

            {/* Input area with integrated mode selector */}
            {!showCheckpoints && (
              <ProfessionalInput
                onSubmit={handleSubmit}
                onAbort={abortMessage}
                disabled={!activeWorkflowId}
                isLoading={isSendingMessage}
                isAborting={isAborting}
                mode={mode}
                onModeChange={setMode}
                value={inputValue}
                onChange={setInputValue}
              />
            )}
          </>
        )}
      </div>
    </>
  )
})

Copilot.displayName = 'Copilot'
