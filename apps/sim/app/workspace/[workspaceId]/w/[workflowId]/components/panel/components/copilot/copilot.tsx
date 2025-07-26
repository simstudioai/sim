'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Bot, ChevronDown, History, MessageSquarePlus, MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { createLogger } from '@/lib/logs/console-logger'
import { usePreviewStore } from '@/stores/copilot/preview-store'
import { useCopilotStore } from '@/stores/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useCopilotSandbox } from '../../../../hooks/use-copilot-sandbox'
import { CopilotSandboxModal } from '../../../copilot-sandbox-modal/copilot-sandbox-modal'
import { CheckpointPanel } from './components/checkpoint-panel'
import { CopilotModal } from './components/copilot-modal/copilot-modal'
import { ProfessionalInput } from './components/professional-input/professional-input'
import { ProfessionalMessage } from './components/professional-message/professional-message'
import { CopilotWelcome } from './components/welcome/welcome'

const logger = createLogger('Copilot')

interface CopilotProps {
  panelWidth: number
  isFullscreen?: boolean
  onFullscreenToggle?: (fullscreen: boolean) => void
  fullscreenInput?: string
  onFullscreenInputChange?: (input: string) => void
}

interface CopilotRef {
  clearMessages: () => void
  startNewChat: () => void
}

export const Copilot = forwardRef<CopilotRef, CopilotProps>(
  (
    {
      panelWidth,
      isFullscreen = false,
      onFullscreenToggle,
      fullscreenInput = '',
      onFullscreenInputChange,
    },
    ref
  ) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [showCheckpoints, setShowCheckpoints] = useState(false)
    const scannedChatRef = useRef<string | null>(null)

    const { activeWorkflowId } = useWorkflowRegistry()

    // Use copilot sandbox for workflow previews
    const { sandboxState, showSandbox, closeSandbox, applyToCurrentWorkflow, saveAsNewWorkflow } =
      useCopilotSandbox()

    // Use preview store to track seen previews
    const { scanAndMarkExistingPreviews, isToolCallSeen, markToolCallAsSeen } = usePreviewStore()

    // Use the new copilot store
    const {
      currentChat,
      chats,
      messages,
      isLoading,
      isLoadingChats,
      isSendingMessage,
      isAborting,
      error,
      workflowId,
      mode,
      setWorkflowId,
      validateCurrentChat,
      selectChat,
      createNewChat,
      deleteChat,
      sendMessage,
      abortMessage,
      clearMessages,
      clearError,
      setMode,
    } = useCopilotStore()

    // Sync workflow ID with store
    useEffect(() => {
      if (activeWorkflowId !== workflowId) {
        setWorkflowId(activeWorkflowId).catch((error) => {
          console.error('Failed to set workflow ID:', error)
        })
      }
    }, [activeWorkflowId, workflowId, setWorkflowId])

    // Clear any existing preview when component mounts or workflow changes
    useEffect(() => {
      // Preview clearing is now handled automatically by the copilot store
    }, [activeWorkflowId])

    // Safety check: Clear any chat that doesn't belong to current workflow
    useEffect(() => {
      if (activeWorkflowId && workflowId === activeWorkflowId) {
        // Validate that current chat belongs to this workflow
        validateCurrentChat()
      }
    }, [currentChat, chats, activeWorkflowId, workflowId, validateCurrentChat])

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

    // Watch for completed preview_workflow tool calls in the new format
    useEffect(() => {
      if (!messages.length) return

      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role !== 'assistant' || !lastMessage.toolCalls) return

      // Check for completed preview_workflow tool calls
      const previewToolCall = lastMessage.toolCalls.find(
        (tc) => tc.name === 'preview_workflow' && tc.state === 'completed' && !isToolCallSeen(tc.id)
      )

      if (previewToolCall?.result) {
        logger.info('Preview workflow completed via native SSE - handling result')
        // Mark as seen to prevent duplicate processing
        markToolCallAsSeen(previewToolCall.id)
        // Tool call handling logic would go here if needed
      }
    }, [messages, isToolCallSeen, markToolCallAsSeen])

    // Handle chat deletion
    const handleDeleteChat = useCallback(
      async (chatId: string) => {
        try {
          await deleteChat(chatId)
          logger.info('Chat deleted successfully')
        } catch (error) {
          logger.error('Error deleting chat:', error)
        }
      },
      [deleteChat]
    )

    // Handle new chat creation
    const handleStartNewChat = useCallback(() => {
      // Preview clearing is now handled automatically by the copilot store
      clearMessages()
      logger.info('Started new chat')
    }, [clearMessages])

    // Expose functions to parent
    useImperativeHandle(
      ref,
      () => ({
        clearMessages: handleStartNewChat,
        startNewChat: handleStartNewChat,
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
        <div
          className='flex h-full max-w-full flex-col overflow-hidden'
          style={{ width: `${panelWidth}px`, maxWidth: `${panelWidth}px` }}
        >
          {/* Show loading state with centered pulsing agent icon */}
          {isLoadingChats || isLoading ? (
            <div className='flex h-full items-center justify-center'>
              <div className='flex items-center justify-center'>
                <Bot className='h-16 w-16 animate-pulse text-muted-foreground' />
              </div>
            </div>
          ) : (
            <>
              {/* Header with Chat Title and Management */}
              <div className='border-b p-4'>
                <div className='flex items-center justify-between'>
                  {/* Chat Title Dropdown */}
                  <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        className='h-8 min-w-0 flex-1 justify-start px-3 hover:bg-accent/50'
                      >
                        <span className='truncate'>
                          {/* Only show chat title if we have verified workflow match */}
                          {currentChat &&
                          workflowId === activeWorkflowId &&
                          chats.some((chat) => chat.id === currentChat.id)
                            ? currentChat.title || 'New Chat'
                            : 'New Chat'}
                        </span>
                        <ChevronDown className='ml-2 h-4 w-4 shrink-0' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align='start'
                      className='z-[110] w-72 border-border/50 bg-background/95 shadow-lg backdrop-blur-sm'
                      sideOffset={8}
                      onMouseLeave={() => setIsDropdownOpen(false)}
                    >
                      {isLoadingChats ? (
                        <div className='px-4 py-3 text-muted-foreground text-sm'>
                          Loading chats...
                        </div>
                      ) : chats.length === 0 ? (
                        <div className='px-4 py-3 text-muted-foreground text-sm'>No chats yet</div>
                      ) : (
                        // Sort chats by updated date (most recent first) for display
                        [...chats]
                          .sort(
                            (a, b) =>
                              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                          )
                          .map((chat) => (
                            <div key={chat.id} className='group flex items-center gap-2 px-2 py-1'>
                              <DropdownMenuItem asChild>
                                <div
                                  onClick={() => {
                                    selectChat(chat)
                                    setIsDropdownOpen(false)
                                  }}
                                  className={`min-w-0 flex-1 cursor-pointer rounded-lg px-3 py-2.5 transition-all ${
                                    currentChat?.id === chat.id
                                      ? 'bg-accent/80 text-accent-foreground'
                                      : 'hover:bg-accent/40'
                                  }`}
                                >
                                  <div className='min-w-0'>
                                    <div className='truncate font-medium text-sm leading-tight'>
                                      {chat.title || 'Untitled Chat'}
                                    </div>
                                    <div className='mt-0.5 truncate text-muted-foreground text-xs'>
                                      {new Date(chat.updatedAt).toLocaleDateString()} at{' '}
                                      {new Date(chat.updatedAt).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}{' '}
                                      • {chat.messageCount}
                                    </div>
                                  </div>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 w-7 shrink-0 p-0 hover:bg-accent/60'
                                  >
                                    <MoreHorizontal className='h-3.5 w-3.5' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align='end'
                                  className='z-[120] border-border/50 bg-background/95 shadow-lg backdrop-blur-sm'
                                >
                                  <DropdownMenuItem
                                    onClick={() => handleDeleteChat(chat.id)}
                                    className='cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive'
                                  >
                                    <Trash2 className='mr-2 h-3.5 w-3.5' />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Checkpoint Toggle Button */}
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setShowCheckpoints(!showCheckpoints)}
                    className={`h-8 w-8 p-0 ${
                      showCheckpoints
                        ? 'bg-[#802FFF]/20 text-[#802FFF] hover:bg-[#802FFF]/30'
                        : 'hover:bg-accent/50'
                    }`}
                    title='View Checkpoints'
                  >
                    <History className='h-4 w-4' />
                  </Button>

                  {/* New Chat Button */}
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleStartNewChat}
                    className='h-8 w-8 p-0'
                    title='New Chat'
                  >
                    <MessageSquarePlus className='h-4 w-4' />
                  </Button>
                </div>

                {/* Error display */}
                {error && (
                  <div className='mt-2 rounded-md bg-destructive/10 p-2 text-destructive text-sm'>
                    {error}
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={clearError}
                      className='ml-2 h-auto p-1 text-destructive'
                    >
                      Dismiss
                    </Button>
                  </div>
                )}
              </div>

              {/* Messages area or Checkpoint Panel */}
              {showCheckpoints ? (
                <CheckpointPanel />
              ) : (
                <ScrollArea ref={scrollAreaRef} className='flex-1 overflow-hidden px-2'>
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

              {/* Mode Selector and Input */}
              {!showCheckpoints && (
                <>
                  {/* Mode Selector */}
                  <div className='border-t px-4 pt-2 pb-1'>
                    <div className='flex items-center gap-1 rounded-md border bg-muted/30 p-0.5'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setMode('ask')}
                        className={`h-6 flex-1 font-medium text-xs ${
                          mode === 'ask'
                            ? 'bg-[#802FFF]/20 text-[#802FFF] hover:bg-[#802FFF]/30'
                            : 'hover:bg-muted/50'
                        }`}
                        title='Ask questions and get answers. Cannot edit workflows.'
                      >
                        Ask
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setMode('agent')}
                        className={`h-6 flex-1 font-medium text-xs ${
                          mode === 'agent'
                            ? 'bg-[#802FFF]/20 text-[#802FFF] hover:bg-[#802FFF]/30'
                            : 'hover:bg-muted/50'
                        }`}
                        title='Full agent with workflow editing capabilities.'
                      >
                        Agent
                      </Button>
                    </div>
                  </div>

                  {/* Input area */}
                  <ProfessionalInput
                    onSubmit={handleSubmit}
                    onAbort={abortMessage}
                    disabled={!activeWorkflowId}
                    isLoading={isSendingMessage}
                    isAborting={isAborting}
                  />
                </>
              )}
            </>
          )}
        </div>

        {/* Fullscreen Modal */}
        <CopilotModal
          open={isFullscreen}
          onOpenChange={(open) => onFullscreenToggle?.(open)}
          copilotMessage={fullscreenInput}
          setCopilotMessage={(message) => onFullscreenInputChange?.(message)}
          messages={messages}
          onSendMessage={handleModalSendMessage}
          onAbortMessage={abortMessage}
          isLoading={isSendingMessage}
          isAborting={isAborting}
          isLoadingChats={isLoadingChats}
          chats={chats}
          currentChat={currentChat}
          onSelectChat={selectChat}
          onStartNewChat={handleStartNewChat}
          onDeleteChat={handleDeleteChat}
          mode={mode}
          onModeChange={setMode}
        />

        {/* Copilot Sandbox Modal */}
        <CopilotSandboxModal
          isOpen={sandboxState.isOpen}
          onClose={closeSandbox}
          proposedWorkflowState={sandboxState.proposedWorkflowState}
          yamlContent={sandboxState.yamlContent}
          description={sandboxState.description}
          onApplyToCurrentWorkflow={applyToCurrentWorkflow}
          onSaveAsNewWorkflow={async (name: string) => {
            await saveAsNewWorkflow(name)
          }}
          isProcessing={sandboxState.isProcessing}
        />
      </>
    )
  }
)

Copilot.displayName = 'Copilot'
