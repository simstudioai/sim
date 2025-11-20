'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, CircleSlash, History, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LandingPromptStorage } from '@/lib/browser-storage'
import { createLogger } from '@/lib/logs/console/logger'
import { useChatStore } from '@/stores/chat/store'
import { usePanelStore } from '@/stores/panel/store'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { Copilot } from '../panel-new/components/copilot/copilot'
// import { Chat } from './components/chat/chat'
import { Console } from './components/console/console'
import { Variables } from './components/variables/variables'

const logger = createLogger('Panel')

export function Panel() {
  const [chatMessage, setChatMessage] = useState<string>('')
  const [isHistoryDropdownOpen, setIsHistoryDropdownOpen] = useState(false)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editingChatTitle, setEditingChatTitle] = useState<string>('')

  const [isResizing, setIsResizing] = useState(false)
  const [resizeStartX, setResizeStartX] = useState(0)
  const [resizeStartWidth, setResizeStartWidth] = useState(0)
  const copilotRef = useRef<{
    createNewChat: () => void
    setInputValueAndFocus: (value: string) => void
  }>(null)
  const lastLoadedWorkflowRef = useRef<string | null>(null)

  const isOpen = usePanelStore((state) => state.isOpen)
  const togglePanel = usePanelStore((state) => state.togglePanel)
  const activeTab = usePanelStore((state) => state.activeTab)
  const setActiveTab = usePanelStore((state) => state.setActiveTab)
  const panelWidth = usePanelStore((state) => state.panelWidth)
  const setPanelWidth = usePanelStore((state) => state.setPanelWidth)

  const clearConsole = useTerminalConsoleStore((state) => state.clearConsole)
  const exportConsoleCSV = useTerminalConsoleStore((state) => state.exportConsoleCSV)
  const clearChat = useChatStore((state) => state.clearChat)
  const exportChatCSV = useChatStore((state) => state.exportChatCSV)
  const { activeWorkflowId } = useWorkflowRegistry()

  // Copilot store for chat management
  const {
    chats,
    isLoadingChats,
    isSendingMessage,
    selectChat,
    currentChat,
    error: copilotError,
    clearError: clearCopilotError,
    deleteChat,
    workflowId: copilotWorkflowId,
    setWorkflowId: setCopilotWorkflowId,
    loadChats,
    validateCurrentChat,
    areChatsFresh,
  } = useCopilotStore()

  // Handle chat deletion
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

  // Ensure copilot data is loaded before performing actions
  const ensureCopilotDataLoaded = useCallback(
    async (forceRefresh = false) => {
      try {
        // Don't load if already loading, unless force refresh is requested
        if (isLoadingChats && !forceRefresh) {
          return
        }

        // Sync workflow ID if needed
        if (activeWorkflowId !== copilotWorkflowId) {
          await setCopilotWorkflowId(activeWorkflowId)
        }

        // Load chats for the current workflow - let the store handle caching
        if (activeWorkflowId) {
          await loadChats(forceRefresh)

          // Only validate current chat if we're not actively streaming
          // This prevents clearing the current conversation during a stream
          if (!isSendingMessage) {
            validateCurrentChat()
          }

          // Mark this workflow as loaded for the legacy ref
          lastLoadedWorkflowRef.current = activeWorkflowId
        }
      } catch (error) {
        logger.error('Failed to load copilot data:', error)
      }
    },
    [
      activeWorkflowId,
      copilotWorkflowId,
      setCopilotWorkflowId,
      loadChats,
      validateCurrentChat,
      isLoadingChats,
      isSendingMessage,
    ]
  )

  // Handle new chat creation with data loading
  const handleNewChat = useCallback(async () => {
    // Instantly clear to a fresh chat locally
    copilotRef.current?.createNewChat()
    // Ensure copilot data is loaded in the background (do not await)
    ensureCopilotDataLoaded().catch(() => {})
  }, [ensureCopilotDataLoaded])

  // Handle history dropdown opening - use smart caching instead of force refresh
  const handleHistoryDropdownOpen = useCallback(
    async (open: boolean) => {
      // Open dropdown immediately for better UX
      setIsHistoryDropdownOpen(open)

      // If opening and there's an active stream, don't do any data loading at all
      // Just show what's already loaded to avoid any interference
      if (open && activeWorkflowId && !isSendingMessage) {
        // Only load if we don't have fresh chats for this workflow AND we're not streaming
        if (!areChatsFresh(activeWorkflowId)) {
          // Don't await - let it load in background while dropdown is already open
          ensureCopilotDataLoaded(false).catch((error) => {
            logger.error('Failed to load chat history:', error)
          })
        }
      }

      // If streaming, just log that we're showing cached data
      if (open && isSendingMessage) {
        logger.info('Chat history opened during stream - showing cached data only')
      }
    },
    [ensureCopilotDataLoaded, activeWorkflowId, areChatsFresh, isSendingMessage]
  )

  // Group chats by day
  const groupedChats = useMemo(() => {
    // Only process chats if we have the right workflow ID and chats exist
    if (!activeWorkflowId || copilotWorkflowId !== activeWorkflowId || chats.length === 0) {
      return []
    }

    // Chats are already filtered by workflow from the API and ordered by updatedAt desc
    const filteredChats = chats

    if (filteredChats.length === 0) {
      return []
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    const thisWeekStart = new Date(today.getTime() - today.getDay() * 24 * 60 * 60 * 1000)
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

    const groups: Record<string, typeof filteredChats> = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      'Last Week': [],
      Older: [],
    }

    // Chats are already sorted by updatedAt desc from the API, so we don't need to sort again
    filteredChats.forEach((chat) => {
      const chatDate = new Date(chat.updatedAt)
      const chatDay = new Date(chatDate.getFullYear(), chatDate.getMonth(), chatDate.getDate())

      if (chatDay.getTime() === today.getTime()) {
        groups.Today.push(chat)
      } else if (chatDay.getTime() === yesterday.getTime()) {
        groups.Yesterday.push(chat)
      } else if (chatDay.getTime() >= thisWeekStart.getTime()) {
        groups['This Week'].push(chat)
      } else if (chatDay.getTime() >= lastWeekStart.getTime()) {
        groups['Last Week'].push(chat)
      } else {
        groups.Older.push(chat)
      }
    })

    // Filter out empty groups
    return Object.entries(groups).filter(([, chats]) => chats.length > 0)
  }, [chats, activeWorkflowId, copilotWorkflowId])

  // Skeleton loading component for chat history
  const ChatHistorySkeleton = () => (
    <div className='px-1 py-1'>
      {/* Group header skeleton */}
      <div className='border-[#E5E5E5] border-t-0 px-1 pt-1 pb-0.5 dark:border-[#414141]'>
        <div className='h-3 w-12 animate-pulse rounded bg-muted/40' />
      </div>
      {/* Chat item skeletons */}
      <div className='mt-1 flex flex-col gap-1'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='mx-1 flex h-8 items-center rounded-lg px-2 py-1.5'>
            <div className='h-3 w-full animate-pulse rounded bg-muted/40' />
          </div>
        ))}
      </div>
    </div>
  )

  // Handle tab clicks - no loading, just switch tabs
  const handleTabClick = async (tab: 'chat' | 'console' | 'variables' | 'copilot') => {
    setActiveTab(tab)
    if (!isOpen) {
      togglePanel()
    }
    // Removed copilot data loading - store should persist across tab switches
  }

  const handleClosePanel = () => {
    togglePanel()
  }

  // Resize functionality
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isOpen) return
      e.preventDefault()
      setIsResizing(true)
      setResizeStartX(e.clientX)
      setResizeStartWidth(panelWidth)
    },
    [isOpen, panelWidth]
  )

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return
      const deltaX = resizeStartX - e.clientX // Subtract because we're expanding left
      const newWidth = resizeStartWidth + deltaX
      setPanelWidth(newWidth)
    },
    [isResizing, resizeStartX, resizeStartWidth, setPanelWidth]
  )

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  // Add global mouse event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleResizeEnd)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      return () => {
        document.removeEventListener('mousemove', handleResize)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing, handleResize, handleResizeEnd])

  // Only auto-load copilot data when workflow changes, not when switching tabs
  useEffect(() => {
    // Only load when the active workflow changes, not when switching panel tabs
    if (activeWorkflowId && activeWorkflowId !== lastLoadedWorkflowRef.current) {
      // This is a real workflow change, not just a tab switch
      if (copilotWorkflowId !== activeWorkflowId || !copilotWorkflowId) {
        ensureCopilotDataLoaded().catch((error) => {
          logger.error('Failed to auto-load copilot data on workflow change:', error)
        })
      }
    }
  }, [activeWorkflowId, copilotWorkflowId, ensureCopilotDataLoaded])

  useEffect(() => {
    const storedPrompt = LandingPromptStorage.consume()

    if (storedPrompt && storedPrompt.trim().length > 0) {
      setActiveTab('copilot')
      if (!isOpen) {
        togglePanel()
      }

      setTimeout(() => {
        if (copilotRef.current) {
          copilotRef.current.setInputValueAndFocus(storedPrompt)
        } else {
          setTimeout(() => {
            if (copilotRef.current) {
              copilotRef.current.setInputValueAndFocus(storedPrompt)
            }
          }, 500)
        }
      }, 200)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- Run only on mount

  return (
    <>
      {/* Tab Selector - Always visible */}
      <div className='fixed top-[76px] right-4 z-20 flex h-9 w-[308px] items-center gap-1 rounded-[14px] border bg-card px-[2.5px] py-1 shadow-xs'>
        <button
          onClick={() => handleTabClick('copilot')}
          className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
            isOpen && activeTab === 'copilot' ? 'panel-tab-active' : 'panel-tab-inactive'
          }`}
        >
          Copilot
        </button>
        <button
          onClick={() => handleTabClick('console')}
          className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
            isOpen && activeTab === 'console' ? 'panel-tab-active' : 'panel-tab-inactive'
          }`}
        >
          Console
        </button>
        <button
          onClick={() => handleTabClick('chat')}
          className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
            isOpen && activeTab === 'chat' ? 'panel-tab-active' : 'panel-tab-inactive'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => handleTabClick('variables')}
          className={`panel-tab-base inline-flex flex-1 cursor-pointer items-center justify-center rounded-[10px] border border-transparent py-1 font-[450] text-sm outline-none transition-colors duration-200 ${
            isOpen && activeTab === 'variables' ? 'panel-tab-active' : 'panel-tab-inactive'
          }`}
        >
          Variables
        </button>
      </div>

      {/* Panel Content - Only visible when isOpen is true */}
      {isOpen && (
        <div
          className='fixed top-[124px] right-4 bottom-4 z-10 flex flex-col rounded-[14px] border bg-card shadow-xs'
          style={{ width: `${panelWidth}px` }}
        >
          {/* Invisible resize handle */}
          <div
            className='-left-1 absolute top-0 bottom-0 w-2 cursor-col-resize'
            onMouseDown={handleResizeStart}
          />

          {/* Header - Fixed width content */}
          <div className='flex items-center justify-between px-3 pt-3 pb-1'>
            <h2 className='font-[450] text-base text-card-foreground capitalize'>{activeTab}</h2>
            <div className='flex items-center gap-2'>
              {activeTab === 'console' && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => activeWorkflowId && exportConsoleCSV(activeWorkflowId)}
                      className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                      style={{ color: 'var(--base-muted-foreground)' }}
                    >
                      <ArrowDownToLine className='h-4 w-4' strokeWidth={2} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom'>Export console data</Tooltip.Content>
                </Tooltip.Root>
              )}
              {activeTab === 'chat' && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => activeWorkflowId && exportChatCSV(activeWorkflowId)}
                      className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                      style={{ color: 'var(--base-muted-foreground)' }}
                    >
                      <ArrowDownToLine className='h-4 w-4' strokeWidth={2} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom'>Export chat data</Tooltip.Content>
                </Tooltip.Root>
              )}
              {activeTab === 'copilot' && (
                <>
                  {/* New Chat Button */}
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        onClick={handleNewChat}
                        className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                        style={{ color: 'var(--base-muted-foreground)' }}
                      >
                        <Plus className='h-4 w-4' strokeWidth={2} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='bottom'>New chat</Tooltip.Content>
                  </Tooltip.Root>

                  {/* History Dropdown */}
                  <DropdownMenu
                    open={isHistoryDropdownOpen}
                    onOpenChange={handleHistoryDropdownOpen}
                  >
                    <Tooltip.Root>
                      <DropdownMenuTrigger asChild>
                        <Tooltip.Trigger asChild>
                          <button
                            className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                            style={{ color: 'var(--base-muted-foreground)' }}
                          >
                            <History className='h-4 w-4' strokeWidth={2} />
                          </button>
                        </Tooltip.Trigger>
                      </DropdownMenuTrigger>
                      <Tooltip.Content side='bottom'>Chat history</Tooltip.Content>
                    </Tooltip.Root>
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
                          {groupedChats.map(([groupName, chats], groupIndex) => (
                            <div key={groupName}>
                              <div
                                className={`px-2 pt-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide ${groupIndex === 0 ? 'pt-0' : ''}`}
                              >
                                {groupName}
                              </div>
                              <div className='flex flex-col gap-0.5'>
                                {chats.map((chat) => (
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
                                            const newTitle = editingChatTitle.trim() || 'New Chat'

                                            // Update optimistically in store first
                                            const updatedChats = chats.map((c) =>
                                              c.id === chat.id ? { ...c, title: newTitle } : c
                                            )
                                            useCopilotStore.setState({ chats: updatedChats })

                                            // Exit edit mode immediately
                                            setEditingChatId(null)

                                            // Save to database in background
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
                                              // Revert on error
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
                                            // Only call selectChat if it's a different chat
                                            if (currentChat?.id !== chat.id) {
                                              selectChat(chat)
                                            }
                                            setIsHistoryDropdownOpen(false)
                                          }}
                                          className='min-w-0 cursor-pointer truncate text-sm'
                                          style={{ maxWidth: 'calc(100% - 60px)' }}
                                        >
                                          {chat.title || 'New Chat'}
                                        </span>
                                        <div className='ml-auto flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setEditingChatId(chat.id)
                                              setEditingChatTitle(chat.title || 'New Chat')
                                            }}
                                            className='flex h-5 w-5 items-center justify-center rounded hover:bg-muted'
                                          >
                                            <Pencil className='h-3 w-3 text-muted-foreground' />
                                          </button>
                                          <button
                                            onClick={async (e) => {
                                              e.stopPropagation()

                                              // Check if deleting current chat
                                              const isDeletingCurrent = currentChat?.id === chat.id

                                              // Delete the chat (optimistic update happens in store)
                                              await handleDeleteChat(chat.id)

                                              // If deleted current chat, create new one
                                              if (isDeletingCurrent) {
                                                copilotRef.current?.createNewChat()
                                              }
                                            }}
                                            className='flex h-5 w-5 items-center justify-center rounded hover:bg-muted'
                                          >
                                            <Trash2 className='h-3 w-3 text-muted-foreground' />
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
                </>
              )}
              {(activeTab === 'console' || activeTab === 'chat') && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => {
                        if (activeTab === 'console') {
                          clearConsole(activeWorkflowId)
                        } else if (activeTab === 'chat') {
                          clearChat(activeWorkflowId)
                        }
                      }}
                      className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                      style={{ color: 'var(--base-muted-foreground)' }}
                    >
                      <CircleSlash className='h-4 w-4' strokeWidth={2} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='bottom'>Clear {activeTab}</Tooltip.Content>
                </Tooltip.Root>
              )}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={handleClosePanel}
                    className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
                    style={{ color: 'var(--base-muted-foreground)' }}
                  >
                    <X className='h-4 w-4' strokeWidth={2} />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content side='bottom'>Close panel</Tooltip.Content>
              </Tooltip.Root>
            </div>
          </div>

          {/* Panel Content Area - Resizable */}
          <div className='flex-1 overflow-hidden px-3'>
            {/* Keep all tabs mounted but hidden to preserve state and animations */}
            <div style={{ display: activeTab === 'chat' ? 'block' : 'none', height: '100%' }}>
              {/* <Chat chatMessage={chatMessage} setChatMessage={setChatMessage} /> */}
            </div>
            <div style={{ display: activeTab === 'console' ? 'block' : 'none', height: '100%' }}>
              <Console panelWidth={panelWidth} />
            </div>
            <div style={{ display: activeTab === 'copilot' ? 'block' : 'none', height: '100%' }}>
              <Copilot ref={copilotRef} panelWidth={panelWidth} />
            </div>
            <div style={{ display: activeTab === 'variables' ? 'block' : 'none', height: '100%' }}>
              <Variables />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
