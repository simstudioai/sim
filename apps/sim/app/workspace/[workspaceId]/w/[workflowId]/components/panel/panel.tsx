'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Bot, History, Pencil, Plus, TerminalSquare, Wrench } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { ConversationListItem } from '@/app/workspace/[workspaceId]/components'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components'
import { getWorkflowCopilotUseChatOptions, useChat } from '@/app/workspace/[workspaceId]/home/hooks'
import type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  Editor,
  Toolbar,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components'
import {
  usePanelResize,
  useUsageLimits,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { Terminal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/terminal'
import { Variables } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/variables/variables'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import type { ChatContext, PanelTab } from '@/stores/panel'
import { usePanelStore } from '@/stores/panel'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { captureBaselineSnapshot } from '@/stores/workflow-diff/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('Panel')

/**
 * Floating panel sidebar with tab navigation that persists across page refreshes.
 *
 * Renders as a floating overlay on the right side of the canvas with rounded corners
 * and a collapsible toggle. Tabs: Copilot, Toolbar, Editor, Logs.
 *
 * Uses a CSS-based approach to prevent hydration mismatches and flash on load:
 * 1. Width is controlled by CSS variable (--panel-width)
 * 2. Blocking script in layout.tsx sets CSS variable and data-panel-active-tab before React hydrates
 * 3. CSS rules control initial visibility based on data-panel-active-tab attribute
 * 4. React takes over visibility control after hydration completes
 * 5. Store updates CSS variable when width changes
 *
 * @returns Floating panel on the right side of the canvas
 */
interface PanelProps {
  /** Override workspaceId when rendered outside a workspace route (e.g. sandbox mode) */
  workspaceId?: string
}

export const Panel = memo(function Panel({ workspaceId: propWorkspaceId }: PanelProps = {}) {
  const params = useParams()
  const workspaceId = propWorkspaceId ?? (params.workspaceId as string)

  const panelRef = useRef<HTMLElement>(null)
  const {
    activeTab,
    setActiveTab,
    panelWidth,
    isPanelOpen,
    setIsPanelOpen,
    _hasHydrated,
    setHasHydrated,
    pendingCopilotMessage,
    setPendingCopilotMessage,
  } = usePanelStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      panelWidth: state.panelWidth,
      isPanelOpen: state.isPanelOpen,
      setIsPanelOpen: state.setIsPanelOpen,
      _hasHydrated: state._hasHydrated,
      setHasHydrated: state.setHasHydrated,
      pendingCopilotMessage: state.pendingCopilotMessage,
      setPendingCopilotMessage: state.setPendingCopilotMessage,
    }))
  )
  const toolbarRef = useRef<{
    focusSearch: () => void
  } | null>(null)
  const { data: session } = useSession()

  // Hooks
  const { config: permissionConfig } = usePermissionConfig()
  const { activeWorkflowId, hydration } = useWorkflowRegistry(
    useShallow((state) => ({
      activeWorkflowId: state.activeWorkflowId,
      hydration: state.hydration,
    }))
  )
  const isRegistryLoading = hydration.phase === 'idle' || hydration.phase === 'state-loading'
  const { navigateToSettings } = useSettingsNavigation()

  // Usage limits hook
  const { usageExceeded } = useUsageLimits({
    context: 'user',
    autoRefresh: !isRegistryLoading,
  })

  // Workflow execution hook
  const { handleRunWorkflow, handleCancelExecution, isExecuting } = useWorkflowExecution()

  // Panel resize hook
  const { handleMouseDown } = usePanelResize()

  const openSubscriptionSettings = () => {
    navigateToSettings({ section: 'subscription' })
  }

  const cancelWorkflow = useCallback(async () => {
    await handleCancelExecution()
  }, [handleCancelExecution])

  const runWorkflow = useCallback(async () => {
    if (usageExceeded) {
      openSubscriptionSettings()
      return
    }
    await handleRunWorkflow()
  }, [usageExceeded, handleRunWorkflow])

  // Copilot chat state
  const [copilotChatId, setCopilotChatId] = useState<string | undefined>(undefined)
  const [copilotChatTitle, setCopilotChatTitle] = useState<string | null>(null)
  const [copilotChatList, setCopilotChatList] = useState<
    { id: string; title: string | null; updatedAt: string; conversationId: string | null }[]
  >([])
  const [isCopilotHistoryOpen, setIsCopilotHistoryOpen] = useState(false)

  const copilotChatIdRef = useRef(copilotChatId)
  copilotChatIdRef.current = copilotChatId
  const copilotInitialLoadDoneRef = useRef(false)

  const loadCopilotChats = useCallback(() => {
    if (!activeWorkflowId) return
    fetch('/api/copilot/chats')
      .then((res) => (res.ok ? res.json() : { chats: [] }))
      .then((data) => {
        const allChats = Array.isArray(data?.chats) ? data.chats : []
        const filtered = allChats.filter(
          (c: { workflowId?: string }) => c.workflowId === activeWorkflowId
        ) as Array<{
          id: string
          title: string | null
          updatedAt: string
          conversationId: string | null
        }>
        setCopilotChatList(filtered)

        const currentId = copilotChatIdRef.current
        if (currentId) {
          const match = filtered.find((c: { id: string }) => c.id === currentId)
          if (match?.title) setCopilotChatTitle(match.title)
        }

        if (!copilotInitialLoadDoneRef.current && !currentId && filtered.length > 0) {
          copilotInitialLoadDoneRef.current = true
          setCopilotChatId(filtered[0].id)
          setCopilotChatTitle(filtered[0].title)
        }
        copilotInitialLoadDoneRef.current = true
      })
      .catch(() => {})
  }, [activeWorkflowId])

  useEffect(() => {
    copilotInitialLoadDoneRef.current = false
    loadCopilotChats()
  }, [loadCopilotChats])

  const handleCopilotSelectChat = useCallback((chat: { id: string; title: string | null }) => {
    setCopilotChatId(chat.id)
    setCopilotChatTitle(chat.title)
    setIsCopilotHistoryOpen(false)
  }, [])

  const handleCopilotDeleteChat = useCallback(
    (chatId: string) => {
      fetch('/api/copilot/chat/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      })
        .then(() => {
          if (copilotChatId === chatId) {
            setCopilotChatId(undefined)
            setCopilotChatTitle(null)
          }
          loadCopilotChats()
        })
        .catch(() => {})
    },
    [copilotChatId, loadCopilotChats]
  )

  const handleCopilotToolResult = useCallback(
    (toolName: string, success: boolean, _output: unknown) => {
      if (toolName !== 'edit_workflow' || !success) return
      const workflowId = activeWorkflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (!workflowId) return

      const baselineWorkflow = captureBaselineSnapshot(workflowId)

      fetch(`/api/workflows/${workflowId}/state`)
        .then((res) => {
          if (!res.ok) throw new Error(`State fetch failed: ${res.status}`)
          return res.json()
        })
        .then((freshState) => {
          const diffStore = useWorkflowDiffStore.getState()
          return diffStore.setProposedChanges(freshState as WorkflowState, undefined, {
            baselineWorkflow,
            skipPersist: true,
          })
        })
        .catch((err) => {
          logger.error('Failed to fetch/apply edit_workflow state', {
            error: err instanceof Error ? err.message : String(err),
            workflowId,
          })
        })
    },
    [activeWorkflowId]
  )

  const {
    messages: copilotMessages,
    isSending: copilotIsSending,
    isReconnecting: copilotIsReconnecting,
    sendMessage: copilotSendMessage,
    stopGeneration: copilotStopGeneration,
    resolvedChatId: copilotResolvedChatId,
    messageQueue: copilotMessageQueue,
    removeFromQueue: copilotRemoveFromQueue,
    sendNow: copilotSendNow,
    editQueuedMessage: copilotEditQueuedMessage,
  } = useChat(
    workspaceId,
    copilotChatId,
    getWorkflowCopilotUseChatOptions({
      workflowId: activeWorkflowId || undefined,
      onTitleUpdate: loadCopilotChats,
      onToolResult: handleCopilotToolResult,
    })
  )

  const handleCopilotNewChat = useCallback(() => {
    if (!activeWorkflowId || !workspaceId) return
    fetch('/api/copilot/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, workflowId: activeWorkflowId }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('create chat failed'))))
      .then((data: { id?: string }) => {
        if (data?.id) {
          setCopilotChatId(data.id)
          setCopilotChatTitle(null)
          loadCopilotChats()
        }
      })
      .catch((err) => {
        logger.error('Failed to create copilot chat', err)
      })
  }, [activeWorkflowId, workspaceId, loadCopilotChats])

  const prevResolvedRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (
      copilotResolvedChatId &&
      copilotResolvedChatId !== prevResolvedRef.current &&
      !copilotChatId
    ) {
      prevResolvedRef.current = copilotResolvedChatId
      setCopilotChatId(copilotResolvedChatId)
      loadCopilotChats()
    } else {
      prevResolvedRef.current = copilotResolvedChatId
    }
  }, [copilotResolvedChatId, copilotChatId, loadCopilotChats])

  const wasCopilotSendingRef = useRef(false)
  useEffect(() => {
    if (wasCopilotSendingRef.current && !copilotIsSending) {
      loadCopilotChats()
    }
    wasCopilotSendingRef.current = copilotIsSending
  }, [copilotIsSending, loadCopilotChats])

  const [copilotEditingInputValue, setCopilotEditingInputValue] = useState('')
  const clearCopilotEditingValue = useCallback(() => setCopilotEditingInputValue(''), [])

  const handleCopilotEditQueuedMessage = useCallback(
    (id: string) => {
      const msg = copilotEditQueuedMessage(id)
      if (msg) setCopilotEditingInputValue(msg.content)
    },
    [copilotEditQueuedMessage]
  )

  const handleCopilotSubmit = useCallback(
    (text: string, fileAttachments?: FileAttachmentForApi[], contexts?: ChatContext[]) => {
      const trimmed = text.trim()
      if (!trimmed && !(fileAttachments && fileAttachments.length > 0)) return
      copilotSendMessage(trimmed || 'Analyze the attached file(s).', fileAttachments, contexts)
    },
    [copilotSendMessage]
  )

  /**
   * Auto-submit a pending copilot message that was queued from the floating input.
   * Consumes the message immediately so it only fires once.
   */
  useEffect(() => {
    if (pendingCopilotMessage && isPanelOpen && activeTab === 'copilot') {
      const message = pendingCopilotMessage
      setPendingCopilotMessage(null)
      handleCopilotSubmit(message)
    }
  }, [pendingCopilotMessage, isPanelOpen, activeTab, setPendingCopilotMessage, handleCopilotSubmit])

  /**
   * Mark hydration as complete on mount
   */
  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<{ message: string }>).detail?.message
      if (!message) return
      setActiveTab('copilot')
      copilotSendMessage(message)
    }
    window.addEventListener('mothership-send-message', handler)
    return () => window.removeEventListener('mothership-send-message', handler)
  }, [setActiveTab, copilotSendMessage])

  /**
   * Context-aware tab switching:
   * When a workflow run finishes, auto-switch to the Logs tab so the user
   * can immediately see results — unless they're actively editing a block.
   */
  const wasExecutingRef = useRef(false)
  useEffect(() => {
    if (wasExecutingRef.current && !isExecuting) {
      // Run just finished — show logs if the user isn't mid-edit
      if (activeTab !== 'editor' && activeTab !== 'copilot') {
        setActiveTab('logs')
        if (!isPanelOpen) setIsPanelOpen(true)
      }
    }
    wasExecutingRef.current = isExecuting
  }, [isExecuting, activeTab, isPanelOpen, setActiveTab, setIsPanelOpen])

  const handleTabClick = (tab: PanelTab) => {
    if (!isPanelOpen) {
      setIsPanelOpen(true)
    }
    setActiveTab(tab)
  }

  /**
   * Register global keyboard shortcuts.
   * - Mod+Enter: Run / cancel workflow
   * - Mod+F: Focus Toolbar tab and search input
   * - Mod+L: Toggle Logs tab
   */
  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'run-workflow',
        handler: () => {
          if (isExecuting) {
            void cancelWorkflow()
          } else {
            void runWorkflow()
          }
        },
        overrides: {
          allowInEditable: false,
        },
      },
      {
        id: 'focus-toolbar-search',
        handler: () => {
          if (!isPanelOpen) setIsPanelOpen(true)
          setActiveTab('toolbar')
          toolbarRef.current?.focusSearch()
        },
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  // When panel is closed, render a thin vertical strip with tab icons
  if (!isPanelOpen) {
    return (
      <>
        <div className='absolute top-[56px] right-4 bottom-4 z-10 flex w-[36px] flex-col items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-2'>
          {/* Expand handle on the left border */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                className='absolute top-1/2 left-0 z-20 flex h-[28px] w-[12px] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] transition-colors hover-hover:bg-[var(--surface-5)]'
                onClick={() => setIsPanelOpen(true)}
                aria-label='Expand panel'
              >
                <svg
                  width='6'
                  height='10'
                  viewBox='0 0 6 10'
                  fill='none'
                  className='text-[var(--text-muted)]'
                >
                  <path
                    d='M5 1L1 5L5 9'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side='left'>Expand panel</Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                className='h-[28px] w-[28px] rounded-md p-0'
                variant='ghost'
                onClick={() => {
                  setIsPanelOpen(true)
                  setActiveTab('editor')
                }}
              >
                <Pencil className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='left'>Editor</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                className='h-[28px] w-[28px] rounded-md p-0'
                variant='ghost'
                onClick={() => {
                  setIsPanelOpen(true)
                  setActiveTab('toolbar')
                }}
              >
                <Wrench className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='left'>Blocks</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                className='h-[28px] w-[28px] rounded-md p-0'
                variant='ghost'
                onClick={() => {
                  setIsPanelOpen(true)
                  setActiveTab('logs')
                }}
              >
                <TerminalSquare className='h-[14px] w-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='left'>Logs</Tooltip.Content>
          </Tooltip.Root>
          {!permissionConfig.hideCopilot && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  className='h-[28px] w-[28px] rounded-md p-0'
                  variant='ghost'
                  onClick={() => {
                    setIsPanelOpen(true)
                    setActiveTab('copilot')
                  }}
                >
                  <Bot className='h-[14px] w-[14px]' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content side='left'>Copilot</Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>
        <Variables />
      </>
    )
  }

  return (
    <>
      {/* Wrapper for collapse handle — matches panel position but no overflow clip */}
      <div className='panel-container pointer-events-none absolute top-[56px] right-4 bottom-4 z-20'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              className='pointer-events-auto absolute top-1/2 left-0 flex h-[28px] w-[12px] -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] transition-colors hover-hover:bg-[var(--surface-5)]'
              onClick={() => setIsPanelOpen(false)}
              aria-label='Collapse panel'
            >
              <svg
                width='6'
                height='10'
                viewBox='0 0 6 10'
                fill='none'
                className='text-[var(--text-muted)]'
              >
                <path
                  d='M1 1L5 5L1 9'
                  stroke='currentColor'
                  strokeWidth='1.5'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content side='left'>Collapse panel</Tooltip.Content>
        </Tooltip.Root>
      </div>

      <aside
        ref={panelRef}
        className='panel-container absolute top-[56px] right-4 bottom-4 z-10 flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]'
        aria-label='Workflow panel'
      >
        {/* Header: tabs — ordered by workflow priority */}
        <div className='flex flex-shrink-0 items-center justify-between px-2 pt-2.5 pb-0'>
          <div className='flex gap-1'>
            <Button
              className={`h-[28px] rounded-md border px-2 py-[5px] text-[12.5px] ${
                _hasHydrated && activeTab === 'editor'
                  ? 'border-[var(--border-1)]'
                  : 'border-transparent hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
              }`}
              variant={_hasHydrated && activeTab === 'editor' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('editor')}
              data-tab-button='editor'
              data-tour='tab-editor'
            >
              Editor
            </Button>
            <Button
              className={`h-[28px] rounded-md border px-2 py-[5px] text-[12.5px] ${
                _hasHydrated && activeTab === 'toolbar'
                  ? 'border-[var(--border-1)]'
                  : 'border-transparent hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
              }`}
              variant={_hasHydrated && activeTab === 'toolbar' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('toolbar')}
              data-tab-button='toolbar'
              data-tour='tab-toolbar'
            >
              Blocks
            </Button>
            <Button
              className={`h-[28px] rounded-md border px-2 py-[5px] text-[12.5px] ${
                _hasHydrated && activeTab === 'logs'
                  ? 'border-[var(--border-1)]'
                  : 'border-transparent hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
              }`}
              variant={_hasHydrated && activeTab === 'logs' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('logs')}
              data-tab-button='logs'
            >
              Logs
            </Button>
            {!permissionConfig.hideCopilot && (
              <Button
                className={`h-[28px] truncate rounded-md border px-2 py-[5px] text-[12.5px] ${
                  _hasHydrated && activeTab === 'copilot'
                    ? 'border-[var(--border-1)]'
                    : 'border-transparent hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
                }`}
                variant={_hasHydrated && activeTab === 'copilot' ? 'active' : 'ghost'}
                onClick={() => handleTabClick('copilot')}
                data-tab-button='copilot'
                data-tour='tab-copilot'
              >
                Copilot
              </Button>
            )}
          </div>
        </div>
        <div className='flex-1 overflow-hidden pt-1'>
          {!permissionConfig.hideCopilot && (
            <div
              className={
                _hasHydrated && activeTab === 'copilot'
                  ? 'flex h-full flex-col'
                  : _hasHydrated
                    ? 'hidden'
                    : 'flex h-full flex-col'
              }
              data-tab-content='copilot'
            >
              {/* Copilot Header */}
              <div className='mx-[-1px] flex flex-shrink-0 items-center justify-between gap-2 border border-[var(--border)] bg-[var(--surface-4)] px-3 py-1.5'>
                <h2 className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
                  {copilotChatTitle || 'New Chat'}
                </h2>
                <div className='flex items-center gap-2'>
                  <Button variant='ghost' className='p-0' onClick={handleCopilotNewChat}>
                    <Plus className='h-[14px] w-[14px]' />
                  </Button>
                  <Popover
                    open={isCopilotHistoryOpen}
                    onOpenChange={(open) => {
                      setIsCopilotHistoryOpen(open)
                      if (open) loadCopilotChats()
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button variant='ghost' className='p-0'>
                        <History className='h-[14px] w-[14px]' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align='end' side='bottom' sideOffset={8} maxHeight={280}>
                      {copilotChatList.length === 0 ? (
                        <div className='px-1.5 py-4 text-center text-[12px] text-muted-foreground'>
                          No chats yet
                        </div>
                      ) : (
                        <PopoverScrollArea>
                          <PopoverSection className='pt-0'>Recent</PopoverSection>
                          <div className='flex flex-col gap-0.5'>
                            {copilotChatList.map((chat) => (
                              <div key={chat.id} className='group'>
                                <PopoverItem
                                  active={copilotChatId === chat.id}
                                  onClick={() => handleCopilotSelectChat(chat)}
                                >
                                  <ConversationListItem
                                    title={chat.title || 'New Chat'}
                                    isActive={Boolean(chat.conversationId)}
                                    titleClassName='text-[13px]'
                                    actions={
                                      <div
                                        className={`flex flex-shrink-0 items-center gap-1 ${copilotChatId !== chat.id ? 'opacity-0 transition-opacity group-hover:opacity-100' : ''}`}
                                      >
                                        <Button
                                          variant='ghost'
                                          className='h-[16px] w-[16px] p-0'
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleCopilotDeleteChat(chat.id)
                                          }}
                                          aria-label='Delete chat'
                                        >
                                          <Trash className='h-[10px] w-[10px]' />
                                        </Button>
                                      </div>
                                    }
                                  />
                                </PopoverItem>
                              </div>
                            ))}
                          </div>
                        </PopoverScrollArea>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Proactive suggestions when copilot is empty */}
              {copilotMessages.length === 0 && !copilotIsSending && (
                <div className='flex flex-col gap-2 px-3 pt-4 pb-2'>
                  <p className='text-[12px] text-[var(--text-muted)]'>Try asking the copilot:</p>
                  <div className='flex flex-col gap-1.5'>
                    {[
                      'Run a test on this workflow',
                      'What does this workflow do?',
                      'Add error handling to this flow',
                      'Help me debug the last failed run',
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        className='rounded-md border border-[var(--border)] bg-[var(--surface-4)] px-3 py-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
                        onClick={() => handleCopilotSubmit(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <MothershipChat
                className='min-h-0 flex-1'
                messages={copilotMessages}
                isSending={copilotIsSending}
                isReconnecting={copilotIsReconnecting}
                onSubmit={handleCopilotSubmit}
                onStopGeneration={copilotStopGeneration}
                messageQueue={copilotMessageQueue}
                onRemoveQueuedMessage={copilotRemoveFromQueue}
                onSendQueuedMessage={copilotSendNow}
                onEditQueuedMessage={handleCopilotEditQueuedMessage}
                userId={session?.user?.id}
                editValue={copilotEditingInputValue}
                onEditValueConsumed={clearCopilotEditingValue}
                layout='copilot-view'
              />
            </div>
          )}
          <div
            className={
              _hasHydrated && activeTab === 'editor' ? 'h-full' : _hasHydrated ? 'hidden' : 'h-full'
            }
            data-tab-content='editor'
          >
            <Editor />
          </div>
          <div
            className={
              _hasHydrated && activeTab === 'toolbar'
                ? 'h-full'
                : _hasHydrated
                  ? 'hidden'
                  : 'h-full'
            }
            data-tab-content='toolbar'
          >
            <Toolbar ref={toolbarRef} isActive={activeTab === 'toolbar'} />
          </div>
          <div
            className={
              _hasHydrated && activeTab === 'logs' ? 'h-full' : _hasHydrated ? 'hidden' : 'h-full'
            }
            data-tab-content='logs'
          >
            <Terminal mode='panel' />
          </div>
        </div>
        <div
          className='absolute top-0 bottom-0 left-[-4px] z-20 w-[8px] cursor-ew-resize'
          onMouseDown={handleMouseDown}
          role='separator'
          aria-orientation='vertical'
          aria-label='Resize panel'
        />
      </aside>
      <Variables />
    </>
  )
})
