'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, History, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
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
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'
import { StreamingIndicator } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/smooth-streaming'
import {
  UserInput,
  type UserInputRef,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/user-input'
import { Welcome } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/welcome/welcome'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import type { CopilotToolCall } from '@/stores/panel/copilot/types'

const MAX_CONTENT_WIDTH = 800

/**
 * Groups chats by date category
 */
function groupChatsByDate(
  chats: Array<{ id: string; title: string | null; createdAt: Date; messages: unknown[] }>
): Array<[string, typeof chats]> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

  const groups: Record<string, typeof chats> = {
    Today: [],
    Yesterday: [],
    'Previous 7 Days': [],
    'Previous 30 Days': [],
    Older: [],
  }

  for (const chat of chats) {
    const chatDate = new Date(chat.createdAt)

    if (chatDate >= today) {
      groups.Today.push(chat)
    } else if (chatDate >= yesterday) {
      groups.Yesterday.push(chat)
    } else if (chatDate >= lastWeek) {
      groups['Previous 7 Days'].push(chat)
    } else if (chatDate >= lastMonth) {
      groups['Previous 30 Days'].push(chat)
    } else {
      groups.Older.push(chat)
    }
  }

  return Object.entries(groups).filter(([, items]) => items.length > 0)
}

/**
 * Superagent - AI agent with full tool access
 * Uses the same copilot store with 'superagent' context
 */
export default function Superagent() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const userInputRef = useRef<UserInputRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [isHistoryDropdownOpen, setIsHistoryDropdownOpen] = useState(false)
  const [containerWidth, setContainerWidth] = useState(MAX_CONTENT_WIDTH)

  const {
    context,
    workspaceId: storeWorkspaceId,
    messages,
    isSendingMessage,
    error,
    chats,
    currentChat,
    isLoadingChats,
    selectedModel,
    setContext,
    setWorkspaceId,
    setSelectedModel,
    sendMessage,
    abortMessage,
    clearMessages,
    loadChats,
    selectChat,
    createNewChat,
  } = useCopilotStore()

  const groupedChats = groupChatsByDate(chats as any)

  // Initialize superagent context
  useEffect(() => {
    if (context !== 'superagent') {
      setContext('superagent')
    }
  }, [context, setContext])

  // Set workspace ID and load chats
  useEffect(() => {
    if (workspaceId && workspaceId !== storeWorkspaceId) {
      setWorkspaceId(workspaceId)
    }
  }, [workspaceId, storeWorkspaceId, setWorkspaceId])

  // Load chats when workspace is set
  useEffect(() => {
    if (context === 'superagent' && storeWorkspaceId) {
      loadChats()
    }
  }, [context, storeWorkspaceId, loadChats])

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth - 48
        setContainerWidth(Math.min(width, MAX_CONTENT_WIDTH))
      }
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = useCallback(
    async (message: string) => {
      const trimmed = message.trim()
      if (!trimmed || isSendingMessage) return

      setInputValue('')
      await sendMessage(trimmed)

      setTimeout(() => userInputRef.current?.focus(), 0)
    },
    [isSendingMessage, sendMessage]
  )

  const handleStartNewChat = useCallback(() => {
    createNewChat()
    setTimeout(() => userInputRef.current?.focus(), 100)
  }, [createNewChat])

  const handleClearMessages = useCallback(() => {
    if (confirm('Clear all messages in this chat?')) {
      clearMessages()
    }
  }, [clearMessages])

  const handleAbort = useCallback(() => {
    abortMessage()
  }, [abortMessage])

  return (
    <div
      ref={containerRef}
      className='fixed inset-0 left-[256px] flex min-w-0 flex-col bg-[var(--surface-3)]'
    >
      <div className='flex h-full flex-col overflow-hidden p-3'>
        {/* Header */}
        <div className='mx-auto w-full max-w-[832px]'>
          <div className='flex flex-shrink-0 items-center justify-between rounded bg-[#2A2A2A] px-3 py-2'>
            <h2 className='font-medium text-sm text-[var(--white)]'>
              {currentChat?.title || 'Superagent'}
            </h2>
            <div className='flex items-center gap-2'>
              {messages.length > 0 && (
                <Button variant='ghost' onClick={handleClearMessages} disabled={isSendingMessage}>
                  <Trash />
                </Button>
              )}
              <Button variant='ghost' onClick={handleStartNewChat}>
                <Plus className='h-3.5 w-3.5' />
              </Button>
              <Popover open={isHistoryDropdownOpen} onOpenChange={setIsHistoryDropdownOpen}>
                <PopoverTrigger asChild>
                  <Button variant='ghost'>
                    <History className='h-3.5 w-3.5' />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='end' side='bottom' sideOffset={8} maxHeight={280}>
                  {isLoadingChats ? (
                    <PopoverScrollArea>
                      <PopoverSection>
                        <div className='h-3 w-12 animate-pulse rounded bg-muted/40' />
                      </PopoverSection>
                      <div className='flex flex-col gap-0.5'>
                        {[1, 2, 3].map((i) => (
                          <div key={i} className='flex h-6 items-center px-1.5'>
                            <div className='h-3 w-full animate-pulse rounded bg-muted/40' />
                          </div>
                        ))}
                      </div>
                    </PopoverScrollArea>
                  ) : groupedChats.length === 0 ? (
                    <div className='px-1.5 py-4 text-center text-xs text-[var(--white)]'>
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
                              <PopoverItem
                                key={chat.id}
                                active={currentChat?.id === chat.id}
                                onClick={() => {
                                  if (currentChat?.id !== chat.id) {
                                    selectChat(chat as any)
                                  }
                                  setIsHistoryDropdownOpen(false)
                                }}
                              >
                                <span className='min-w-0 flex-1 truncate'>
                                  {chat.title || 'Untitled Chat'}
                                </span>
                              </PopoverItem>
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
        </div>

        {/* Messages area or Welcome */}
        {messages.length === 0 && !isSendingMessage ? (
          <div className='mx-auto flex w-full max-w-[832px] flex-1 flex-col overflow-hidden pt-2'>
            <div className='flex-shrink-0'>
              <UserInput
                ref={userInputRef}
                onSubmit={handleSubmit}
                onAbort={handleAbort}
                isLoading={isSendingMessage}
                value={inputValue}
                onChange={setInputValue}
                placeholder='Ask Superagent anything...'
                panelWidth={containerWidth}
                workflowIdOverride={null}
                selectedModelOverride={selectedModel}
                onModelChangeOverride={(model) => setSelectedModel(model as any)}
                hideModeSelector
                disableMentions
              />
            </div>
            <div className='flex-shrink-0 pt-2'>
              <Welcome onQuestionClick={handleSubmit} />
            </div>
          </div>
        ) : (
          <div className='relative flex flex-1 flex-col overflow-hidden'>
            <div ref={scrollAreaRef} className='h-full overflow-y-auto overflow-x-hidden'>
              <div className='mx-auto w-full max-w-[832px] space-y-4 px-4 py-2 pb-10'>
                {messages
                  .filter((m) => m.role === 'user' || m.role === 'assistant')
                  .map((message, index, filteredMessages) => (
                    <SuperagentMessage
                      key={message.id}
                      message={message as any}
                      isStreaming={isSendingMessage && index === filteredMessages.length - 1}
                      panelWidth={containerWidth}
                    />
                  ))}

                {error && (
                  <div className='rounded border border-[var(--text-error)] bg-[var(--text-error)]/10 p-2.5 text-[var(--text-error)] text-sm'>
                    Error: {error}
                  </div>
                )}
              </div>
            </div>

            {/* Input area */}
            <div className='mx-auto w-full max-w-[832px] flex-shrink-0 px-4 pb-2'>
              <UserInput
                ref={userInputRef}
                onSubmit={handleSubmit}
                onAbort={handleAbort}
                isLoading={isSendingMessage}
                value={inputValue}
                onChange={setInputValue}
                placeholder='Ask Superagent anything...'
                panelWidth={containerWidth}
                workflowIdOverride={null}
                selectedModelOverride={selectedModel}
                onModelChangeOverride={(model) => setSelectedModel(model as any)}
                hideModeSelector
                disableMentions
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Get display text for tool call state
 */
function getToolStateDisplay(state: string): { verb: string; isActive: boolean } {
  switch (state) {
    case 'pending':
    case 'executing':
    case 'generating':
      return { verb: 'Running', isActive: true }
    case 'success':
      return { verb: 'Ran', isActive: false }
    case 'error':
      return { verb: 'Failed', isActive: false }
    case 'rejected':
    case 'aborted':
      return { verb: 'Cancelled', isActive: false }
    default:
      return { verb: 'Running', isActive: true }
  }
}

/**
 * Format tool name for display
 */
function formatToolName(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface SuperagentMessageProps {
  message: {
    id: string
    role: 'user' | 'assistant'
    content: string
    contentBlocks?: Array<
      | { type: 'text'; content: string; timestamp: number }
      | { type: 'tool_call'; toolCall: CopilotToolCall; timestamp: number }
    >
  }
  isStreaming: boolean
  panelWidth: number
}

/**
 * Message component - renders using contentBlocks like CopilotMessage
 */
function SuperagentMessage({ message, isStreaming, panelWidth }: SuperagentMessageProps) {
  const isUser = message.role === 'user'
  const [showCopySuccess, setShowCopySuccess] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content)
    setShowCopySuccess(true)
    setTimeout(() => setShowCopySuccess(false), 2000)
  }, [message.content])

  // User message - same style as CopilotMessage
  if (isUser) {
    return (
      <div className='w-full max-w-full overflow-hidden' style={{ maxWidth: `${panelWidth}px` }}>
        <div className='rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[6px] py-[6px] dark:bg-[var(--surface-9)]'>
          <div className='whitespace-pre-wrap break-words px-[2px] py-1 font-medium font-sans text-[#0D0D0D] text-sm leading-[1.25rem] dark:text-gray-100'>
            {message.content}
          </div>
        </div>
      </div>
    )
  }

  // Assistant message - render contentBlocks
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0
  const hasActiveToolCalls = message.contentBlocks?.some(
    (b) =>
      b.type === 'tool_call' &&
      (b.toolCall.state === 'pending' ||
        b.toolCall.state === 'executing' ||
        b.toolCall.state === 'generating')
  )

  return (
    <div className='w-full max-w-full overflow-hidden' style={{ maxWidth: `${panelWidth}px` }}>
      <div className='max-w-full space-y-1.5 px-[2px]'>
        {hasContentBlocks ? (
          message.contentBlocks!.map((block, idx) => {
            if (block.type === 'text') {
              return block.content ? (
                <div key={`text-${idx}`}>
                  <CopilotMarkdownRenderer content={block.content} />
                </div>
              ) : null
            }

            if (block.type === 'tool_call') {
              const { verb, isActive } = getToolStateDisplay(block.toolCall.state as string)
              const displayName =
                block.toolCall.display?.text || formatToolName(block.toolCall.name)

              return (
                <div
                  key={block.toolCall.id}
                  className='font-[470] font-sans text-[13px] text-[var(--text-secondary)]'
                >
                  <span className='text-[var(--text-tertiary)]'>{verb}</span>{' '}
                  <span>{displayName}</span>
                </div>
              )
            }

            return null
          })
        ) : (
          <>
            {!message.content && isStreaming && !hasActiveToolCalls && <StreamingIndicator />}
            {message.content && <CopilotMarkdownRenderer content={message.content} />}
          </>
        )}

        {isStreaming && hasContentBlocks && !hasActiveToolCalls && <StreamingIndicator />}

        {!isStreaming && message.content && (
          <div className='flex items-center gap-2 pt-2'>
            <Button onClick={handleCopy} variant='ghost' title='Copy'>
              {showCopySuccess ? (
                <Check className='h-3.5 w-3.5' strokeWidth={2} />
              ) : (
                <Copy className='h-3.5 w-3.5' strokeWidth={2} />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
