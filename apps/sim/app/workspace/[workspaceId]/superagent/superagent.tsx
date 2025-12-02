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
import { useSuperagentStore } from '@/stores/superagent/store'

/** Maximum content width for readability */
const MAX_CONTENT_WIDTH = 800

/**
 * Convert raw SSE-formatted content into plain text
 */
function parseSSEContent(content: string): string {
  if (!content || !content.includes('data: ')) {
    return content
  }

  let parsed = ''

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue

    const payload = trimmed.slice(6)
    if (!payload) continue

    try {
      const data = JSON.parse(payload)
      if (data.type === 'text' && typeof data.text === 'string') {
        parsed += data.text
      } else if (data.type === 'content' && typeof data.content === 'string') {
        parsed += data.content
      }
    } catch {
      // Ignore malformed JSON payloads
    }
  }

  return parsed || content
}

/**
 * Groups chats by date category (Today, Yesterday, Previous 7 Days, etc.)
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
 * Formats a tool name into a human-readable display name
 */
function formatToolName(name: string): string {
  // Convert snake_case or kebab-case to Title Case
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Superagent - AI agent with full tool access
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
    messages,
    isSendingMessage,
    error,
    workspaceId: storeWorkspaceId,
    chats,
    currentChatId,
    isLoadingChats,
    selectedModel,
    setWorkspaceId,
    setSelectedModel,
    sendMessage,
    abortMessage,
    clearMessages,
    loadChats,
    selectChat,
    createNewChat,
  } = useSuperagentStore()

  const groupedChats = groupChatsByDate(chats)
  const currentChat = chats.find((c) => c.id === currentChatId)

  // Track container width for responsive layout
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth - 48 // Account for padding
        setContainerWidth(Math.min(width, MAX_CONTENT_WIDTH))
      }
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  useEffect(() => {
    if (workspaceId && workspaceId !== storeWorkspaceId) {
      setWorkspaceId(workspaceId)
      loadChats()
    }
  }, [workspaceId, storeWorkspaceId, setWorkspaceId, loadChats])

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
      <div className='flex h-full flex-col overflow-hidden p-[12px]'>
        {/* Header */}
        <div className='mx-auto w-full max-w-[832px]'>
          <div className='flex flex-shrink-0 items-center justify-between rounded-[4px] bg-[#2A2A2A] px-[12px] py-[8px]'>
            <h2 className='font-medium text-[14px] text-[var(--white)]'>
              {currentChat?.title || 'Superagent'}
            </h2>
            <div className='flex items-center gap-[8px]'>
              {messages.length > 0 && (
                <Button variant='ghost' onClick={handleClearMessages} disabled={isSendingMessage}>
                  <Trash />
                </Button>
              )}
              <Button variant='ghost' onClick={handleStartNewChat}>
                <Plus className='h-[14px] w-[14px]' />
              </Button>
              <Popover open={isHistoryDropdownOpen} onOpenChange={setIsHistoryDropdownOpen}>
                <PopoverTrigger asChild>
                  <Button variant='ghost'>
                    <History className='h-[14px] w-[14px]' />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='end' side='bottom' sideOffset={8} maxHeight={280}>
                  {isLoadingChats ? (
                    <PopoverScrollArea>
                      <ChatHistorySkeleton />
                    </PopoverScrollArea>
                  ) : groupedChats.length === 0 ? (
                    <div className='px-[6px] py-[16px] text-center text-[12px] text-[var(--white)]'>
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
                                active={currentChatId === chat.id}
                                onClick={() => {
                                  if (currentChatId !== chat.id) {
                                    selectChat(chat.id)
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
          <div className='mx-auto flex w-full max-w-[832px] flex-1 flex-col overflow-hidden pt-[8px]'>
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
                onModelChangeOverride={setSelectedModel}
                hideModeSelector
                disableMentions
              />
            </div>
            <div className='flex-shrink-0 pt-[8px]'>
              <SuperagentWelcome onQuestionClick={handleSubmit} />
            </div>
          </div>
        ) : (
          <div className='relative flex flex-1 flex-col overflow-hidden'>
            <div ref={scrollAreaRef} className='h-full overflow-y-auto overflow-x-hidden'>
              <div className='mx-auto w-full max-w-[832px] space-y-4 px-[16px] py-[8px] pb-10'>
                {messages.map((message, index) => (
                  <SuperagentMessage
                    key={message.id}
                    message={message}
                    isStreaming={isSendingMessage && index === messages.length - 1}
                    panelWidth={containerWidth}
                  />
                ))}

                {error && (
                  <div className='rounded-[4px] border border-[var(--text-error)] bg-[var(--text-error)]/10 p-[10px] text-[var(--text-error)] text-sm'>
                    Error: {error}
                  </div>
                )}
              </div>
            </div>

            {/* Input area */}
            <div className='mx-auto w-full max-w-[832px] flex-shrink-0 px-[16px] pb-[8px]'>
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
                onModelChangeOverride={setSelectedModel}
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
 * Skeleton loading component for chat history
 */
function ChatHistorySkeleton() {
  return (
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
}

interface SuperagentWelcomeProps {
  onQuestionClick: (question: string) => void
}

/**
 * Welcome screen with suggested actions
 */
function SuperagentWelcome({ onQuestionClick }: SuperagentWelcomeProps) {
  const capabilities = [
    {
      title: 'Explore integrations',
      question: 'What integrations and tools do you have access to?',
    },
    {
      title: 'Automate tasks',
      question: 'Help me automate a task using available tools',
    },
    {
      title: 'Get data',
      question: 'Can you help me fetch and analyze some data?',
    },
  ]

  return (
    <div className='flex w-full flex-col items-center'>
      <div className='flex w-full flex-col items-center gap-[8px]'>
        {capabilities.map(({ title, question }, idx) => (
          <Button
            key={idx}
            variant='active'
            onClick={() => onQuestionClick(question)}
            className='w-full justify-start'
          >
            <div className='flex flex-col items-start'>
              <p className='font-medium'>{title}</p>
              <p className='text-[var(--text-secondary)]'>{question}</p>
            </div>
          </Button>
        ))}
      </div>

      <p className='pt-[12px] text-center text-[13px] text-[var(--text-secondary)]'>
        Superagent has access to <span className='font-medium'>600+ integration tools</span>{' '}
        including GitHub, Google Drive, Slack, and more.
      </p>
    </div>
  )
}

interface ToolCallDisplayProps {
  name: string
  status: 'calling' | 'success' | 'error'
}

/**
 * Displays a tool call with shimmer effect when in progress
 */
function ToolCallDisplay({ name, status }: ToolCallDisplayProps) {
  const displayName = formatToolName(name)
  const isActive = status === 'calling'

  // Get status prefix
  const getStatusText = () => {
    switch (status) {
      case 'calling':
        return 'Running'
      case 'success':
        return 'Ran'
      case 'error':
        return 'Failed'
      default:
        return 'Running'
    }
  }

  const statusText = getStatusText()
  const fullText = `${statusText} ${displayName}`

  return (
    <span className='relative inline-block font-[470] font-sans text-[13px]'>
      <span style={{ color: '#B8B8B8' }}>{statusText}</span>
      <span style={{ color: '#787878' }}> {displayName}</span>
      {isActive && (
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 select-none overflow-hidden'
        >
          <span
            className='block text-transparent'
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)',
              backgroundSize: '200% 100%',
              backgroundRepeat: 'no-repeat',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              animation: 'toolcall-shimmer 1.4s ease-in-out infinite',
              mixBlendMode: 'screen',
            }}
          >
            {fullText}
          </span>
        </span>
      )}
      <style>{`
        @keyframes toolcall-shimmer {
          0% { background-position: 150% 0; }
          50% { background-position: 0% 0; }
          100% { background-position: -150% 0; }
        }
      `}</style>
    </span>
  )
}

interface SuperagentMessageProps {
  message: {
    id: string
    role: 'user' | 'assistant'
    content: string
    toolCalls?: Array<{
      name: string
      status: 'calling' | 'success' | 'error'
    }>
  }
  isStreaming: boolean
  panelWidth: number
}

/**
 * Message component for displaying user and assistant messages
 */
function SuperagentMessage({ message, isStreaming, panelWidth }: SuperagentMessageProps) {
  const isUser = message.role === 'user'
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const renderedContent = parseSSEContent(message.content)

  // Check if we have tool calls in progress (no content yet)
  const hasActiveToolCalls = message.toolCalls?.some((tc) => tc.status === 'calling')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(renderedContent || message.content)
    setShowCopySuccess(true)
    setTimeout(() => setShowCopySuccess(false), 2000)
  }, [renderedContent, message.content])

  if (isUser) {
    return (
      <div className='w-full max-w-full overflow-hidden' style={{ maxWidth: panelWidth }}>
        <div className='rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[6px] py-[6px] dark:bg-[var(--surface-9)]'>
          <div className='whitespace-pre-wrap break-words px-[2px] py-1 font-medium font-sans text-[var(--text-primary)] text-sm leading-[1.25rem]'>
            {message.content}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='w-full max-w-full overflow-hidden' style={{ maxWidth: panelWidth }}>
      <div className='max-w-full space-y-1.5 px-[2px]'>
        {/* Tool calls - shown inline before content */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className='space-y-[6px]'>
            {message.toolCalls.map((tool, idx) => (
              <div key={idx}>
                <ToolCallDisplay name={tool.name} status={tool.status} />
              </div>
            ))}
          </div>
        )}

        {/* Show streaming indicator when no content and no tool calls yet */}
        {!renderedContent && isStreaming && !hasActiveToolCalls && <StreamingIndicator />}

        {/* Message content */}
        {renderedContent && <CopilotMarkdownRenderer content={renderedContent} />}

        {/* Action buttons for completed assistant messages */}
        {!isStreaming && renderedContent && (
          <div className='flex items-center gap-[8px] pt-[8px]'>
            <Button
              onClick={handleCopy}
              variant='ghost'
              title='Copy'
              className='!h-[14px] !w-[14px] !p-0'
            >
              {showCopySuccess ? (
                <Check className='h-[14px] w-[14px]' strokeWidth={2} />
              ) : (
                <Copy className='h-[14px] w-[14px]' strokeWidth={2} />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
