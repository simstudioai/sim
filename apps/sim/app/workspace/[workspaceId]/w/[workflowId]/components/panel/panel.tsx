'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { History, Plus, Square } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  BubbleChatClose,
  BubbleChatPreview,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Layout,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  MoreHorizontal,
  Play,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
  Trash,
} from '@/components/emcn'
import { Lock, Unlock, Upload } from '@/components/emcn/icons'
import { VariableIcon } from '@/components/icons'
import { useSession } from '@/lib/auth/auth-client'
import { generateWorkflowJson } from '@/lib/workflows/operations/import-export'
import { ConversationListItem } from '@/app/workspace/[workspaceId]/components'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components'
import { getWorkflowCopilotUseChatOptions, useChat } from '@/app/workspace/[workspaceId]/home/hooks'
import type { FileAttachmentForApi } from '@/app/workspace/[workspaceId]/home/types'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import {
  Deploy,
  Editor,
  Toolbar,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components'
import {
  usePanelResize,
  useUsageLimits,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { Variables } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/variables/variables'
import { useAutoLayout } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-auto-layout'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { getWorkflowLockToggleIds } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useDeleteWorkflow, useImportWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useDuplicateWorkflowMutation, useWorkflowMap } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useChatStore } from '@/stores/chat/store'
import { useNotificationStore } from '@/stores/notifications/store'
import type { ChatContext, PanelTab } from '@/stores/panel'
import { usePanelStore } from '@/stores/panel'
import { useVariablesModalStore } from '@/stores/variables/modal'
import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { captureBaselineSnapshot } from '@/stores/workflow-diff/utils'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('Panel')
/**
 * Panel component with resizable width and tab navigation that persists across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches and flash on load:
 * 1. Width is controlled by CSS variable (--panel-width)
 * 2. Blocking script in layout.tsx sets CSS variable and data-panel-active-tab before React hydrates
 * 3. CSS rules control initial visibility based on data-panel-active-tab attribute
 * 4. React takes over visibility control after hydration completes
 * 5. Store updates CSS variable when width changes
 *
 * This ensures server and client render identical HTML, preventing hydration errors and visual flash.
 *
 * Note: All tabs are kept mounted but hidden to preserve component state during tab switches.
 * This prevents unnecessary remounting which would trigger data reloads and reset state.
 *
 * @returns Panel on the right side of the workflow
 */
interface PanelProps {
  /** Override workspaceId when rendered outside a workspace route (e.g. sandbox mode) */
  workspaceId?: string
}

export const Panel = memo(function Panel({ workspaceId: propWorkspaceId }: PanelProps = {}) {
  const router = useRouter()
  const params = useParams()
  const workspaceId = propWorkspaceId ?? (params.workspaceId as string)

  const panelRef = useRef<HTMLElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { activeTab, setActiveTab, panelWidth, _hasHydrated, setHasHydrated } = usePanelStore(
    useShallow((state) => ({
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      panelWidth: state.panelWidth,
      _hasHydrated: state._hasHydrated,
      setHasHydrated: state.setHasHydrated,
    }))
  )
  const toolbarRef = useRef<{
    focusSearch: () => void
  } | null>(null)
  const { data: session } = useSession()

  // State
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAutoLayouting, setIsAutoLayouting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Hooks
  const userPermissions = useUserPermissionsContext()
  const { config: permissionConfig } = usePermissionConfig()
  const { isImporting, handleFileChange } = useImportWorkflow({ workspaceId })
  const duplicateWorkflowMutation = useDuplicateWorkflowMutation()
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { activeWorkflowId, hydration } = useWorkflowRegistry(
    useShallow((state) => ({
      activeWorkflowId: state.activeWorkflowId,
      hydration: state.hydration,
    }))
  )
  const isRegistryLoading = hydration.phase === 'idle' || hydration.phase === 'state-loading'
  const { handleAutoLayout: autoLayoutWithFitView } = useAutoLayout(activeWorkflowId || null)

  // Check for locked blocks (disables auto-layout)
  const hasLockedBlocks = useWorkflowStore((state) =>
    Object.values(state.blocks).some((block) => block.locked)
  )

  const allBlocksLocked = useWorkflowStore((state) => {
    const blockList = Object.values(state.blocks)
    return blockList.length > 0 && blockList.every((block) => block.locked)
  })

  const hasBlocks = useWorkflowStore((state) => Object.keys(state.blocks).length > 0)

  const { collaborativeBatchToggleLocked } = useCollaborativeWorkflow()
  const { navigateToSettings } = useSettingsNavigation()

  // Delete workflow hook
  const { isDeleting, handleDeleteWorkflow } = useDeleteWorkflow({
    workspaceId,
    workflowIds: activeWorkflowId || '',
    isActive: true,
    onSuccess: () => setIsDeleteModalOpen(false),
  })

  // Usage limits hook
  const { usageExceeded } = useUsageLimits({
    context: 'user',
    autoRefresh: !isRegistryLoading,
  })

  // Workflow execution hook
  const { handleRunWorkflow, handleCancelExecution, isExecuting } = useWorkflowExecution()

  // Panel resize hook
  const { handleMouseDown } = usePanelResize()

  /**
   * Opens subscription settings modal
   */
  const openSubscriptionSettings = () => {
    navigateToSettings({ section: 'subscription' })
  }

  /**
   * Cancels the currently executing workflow
   */
  const cancelWorkflow = useCallback(async () => {
    await handleCancelExecution()
  }, [handleCancelExecution])

  /**
   * Runs the workflow with usage limit check
   */
  const runWorkflow = useCallback(async () => {
    if (usageExceeded) {
      openSubscriptionSettings()
      return
    }
    await handleRunWorkflow()
  }, [usageExceeded, handleRunWorkflow])

  // Chat state
  const { isChatOpen, setIsChatOpen } = useChatStore(
    useShallow((state) => ({
      isChatOpen: state.isChatOpen,
      setIsChatOpen: state.setIsChatOpen,
    }))
  )
  const { isOpen: isVariablesOpen, setIsOpen: setVariablesOpen } = useVariablesModalStore(
    useShallow((state) => ({
      isOpen: state.isOpen,
      setIsOpen: state.setIsOpen,
    }))
  )

  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null
  const { isSnapshotView } = useCurrentWorkflow()

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
   * Mark hydration as complete on mount
   * This allows React to take over visibility control from CSS
   */
  useEffect(() => {
    setHasHydrated(true)
  }, [setHasHydrated])

  /**
   * Handles tab click events
   */
  const handleTabClick = (tab: PanelTab) => {
    setActiveTab(tab)
  }

  /**
   * Downloads a file with the given content
   */
  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    try {
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Failed to download file:', error)
    }
  }, [])

  /**
   * Handles auto-layout of workflow blocks
   */
  const handleAutoLayout = useCallback(async () => {
    if (isExecuting || !userPermissions.canEdit || isAutoLayouting) {
      return
    }

    setIsAutoLayouting(true)
    try {
      const result = await autoLayoutWithFitView()
      if (!result.success && result.error) {
        useNotificationStore.getState().addNotification({
          level: 'info',
          message: result.error,
          workflowId: activeWorkflowId || undefined,
        })
      }
    } finally {
      setIsAutoLayouting(false)
    }
  }, [
    isExecuting,
    userPermissions.canEdit,
    isAutoLayouting,
    autoLayoutWithFitView,
    activeWorkflowId,
  ])

  /**
   * Handles exporting workflow as JSON
   */
  const handleExportJson = useCallback(async () => {
    if (!currentWorkflow || !activeWorkflowId) {
      logger.warn('No active workflow to export')
      return
    }

    setIsExporting(true)
    try {
      const workflow = getWorkflowWithValues(activeWorkflowId, workspaceId)

      if (!workflow || !workflow.state) {
        throw new Error('No workflow state found')
      }

      const workflowVariables = useVariablesStore
        .getState()
        .getVariablesByWorkflowId(activeWorkflowId)

      const jsonContent = generateWorkflowJson(workflow.state, {
        workflowId: activeWorkflowId,
        name: currentWorkflow.name,
        description: currentWorkflow.description,
        variables: workflowVariables.map((v) => ({
          id: v.id,
          name: v.name,
          type: v.type,
          value: v.value,
        })),
      })

      const filename = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.json`
      downloadFile(jsonContent, filename, 'application/json')
      logger.info('Workflow exported as JSON')
    } catch (error) {
      logger.error('Failed to export workflow as JSON:', error)
    } finally {
      setIsExporting(false)
      setIsMenuOpen(false)
    }
  }, [currentWorkflow, activeWorkflowId, downloadFile])

  /**
   * Handles duplicating the current workflow
   */
  const handleDuplicateWorkflow = useCallback(async () => {
    if (!activeWorkflowId || !userPermissions.canEdit || isDuplicating) {
      return
    }

    const sourceWorkflow = workflows[activeWorkflowId]
    if (!sourceWorkflow) return

    setIsDuplicating(true)
    try {
      const result = await duplicateWorkflowMutation.mutateAsync({
        workspaceId,
        sourceId: activeWorkflowId,
        name: `${sourceWorkflow.name} (Copy)`,
        description: sourceWorkflow.description,
        color: sourceWorkflow.color ?? '',
        folderId: sourceWorkflow.folderId,
      })
      if (result?.id) {
        router.push(`/workspace/${workspaceId}/w/${result.id}`)
      }
    } catch (error) {
      logger.error('Error duplicating workflow:', error)
    } finally {
      setIsDuplicating(false)
      setIsMenuOpen(false)
    }
  }, [activeWorkflowId, userPermissions.canEdit, isDuplicating, workflows, router, workspaceId])

  /**
   * Toggles the locked state of all blocks in the workflow
   */
  const handleToggleWorkflowLock = useCallback(() => {
    const blocks = useWorkflowStore.getState().blocks
    const allLocked = Object.values(blocks).every((b) => b.locked)
    const ids = getWorkflowLockToggleIds(blocks, !allLocked)
    if (ids.length > 0) collaborativeBatchToggleLocked(ids)
    setIsMenuOpen(false)
  }, [collaborativeBatchToggleLocked])

  // Compute run button state
  const canRun = userPermissions.canRead // Running only requires read permissions
  const isLoadingPermissions = userPermissions.isLoading
  const hasValidationErrors = false // TODO: Add validation logic if needed
  const isWorkflowBlocked = isExecuting || hasValidationErrors
  const isButtonDisabled = !isExecuting && (isWorkflowBlocked || (!canRun && !isLoadingPermissions))

  /**
   * Register global keyboard shortcuts using the central commands registry.
   *
   * - Mod+Enter: Run / cancel workflow (matches the Run button behavior)
   * - Mod+F: Focus Toolbar tab and search input
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
          setActiveTab('toolbar')
          toolbarRef.current?.focusSearch()
        },
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  return (
    <>
      <aside
        ref={panelRef}
        className='panel-container relative shrink-0 overflow-hidden bg-[var(--bg)]'
        aria-label='Workflow panel'
      >
        <div className='flex h-full flex-col border-[var(--border)] border-l pt-3.5'>
          {/* Header */}
          <div className='flex flex-shrink-0 items-center justify-between px-2'>
            {/* More and Chat */}
            <div className='flex gap-1.5'>
              <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button className='h-[30px] w-[30px] rounded-[5px]' data-tour='panel-menu'>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' side='bottom' sideOffset={8}>
                  <DropdownMenuItem
                    onSelect={handleAutoLayout}
                    disabled={
                      isExecuting || !userPermissions.canEdit || isAutoLayouting || hasLockedBlocks
                    }
                    title={hasLockedBlocks ? 'Unlock blocks to use auto-layout' : undefined}
                  >
                    <Layout animate={isAutoLayouting} variant='clockwise' />
                    Auto layout
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setVariablesOpen(!isVariablesOpen)}>
                    <VariableIcon />
                    Variables
                  </DropdownMenuItem>
                  {userPermissions.canAdmin && !isSnapshotView && (
                    <DropdownMenuItem onSelect={handleToggleWorkflowLock} disabled={!hasBlocks}>
                      {allBlocksLocked ? <Unlock /> : <Lock />}
                      {allBlocksLocked ? 'Unlock workflow' : 'Lock workflow'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={handleExportJson}
                    disabled={!userPermissions.canEdit || isExporting || !currentWorkflow}
                  >
                    <Upload />
                    Export workflow
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handleDuplicateWorkflow}
                    disabled={!userPermissions.canEdit || isDuplicating}
                  >
                    <Copy animate={isDuplicating} />
                    Duplicate workflow
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setIsDeleteModalOpen(true)
                    }}
                    disabled={!userPermissions.canEdit || Object.keys(workflows).length <= 1}
                  >
                    <Trash />
                    Delete workflow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                className='h-[30px] w-[30px] rounded-[5px]'
                variant={isChatOpen ? 'active' : 'default'}
                onClick={() => setIsChatOpen(!isChatOpen)}
              >
                {isChatOpen ? <BubbleChatClose /> : <BubbleChatPreview />}
              </Button>
            </div>

            {/* Deploy and Run */}
            <div className='flex gap-1.5' data-tour='deploy-run'>
              <Deploy activeWorkflowId={activeWorkflowId} userPermissions={userPermissions} />
              <Button
                className='h-[30px] gap-2 px-2.5'
                data-tour='run-button'
                variant={isExecuting ? 'active' : 'tertiary'}
                onClick={isExecuting ? cancelWorkflow : () => runWorkflow()}
                disabled={!isExecuting && isButtonDisabled}
              >
                {isExecuting ? (
                  <Square className='h-[11.5px] w-[11.5px] fill-current' />
                ) : (
                  <Play className='h-[11.5px] w-[11.5px]' />
                )}
                {isExecuting ? 'Stop' : 'Run'}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className='flex flex-shrink-0 items-center justify-between px-2 pt-3.5'>
            <div className='flex gap-1'>
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
                Toolbar
              </Button>
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
            </div>
          </div>

          {/* Tab Content - Keep all tabs mounted but hidden to preserve state */}
          <div className='flex-1 overflow-hidden pt-3'>
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
                _hasHydrated && activeTab === 'editor'
                  ? 'h-full'
                  : _hasHydrated
                    ? 'hidden'
                    : 'h-full'
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
          </div>
        </div>

        {/* Resize Handle */}
        <div
          className='absolute top-0 bottom-0 left-[-4px] z-20 w-[8px] cursor-ew-resize'
          onMouseDown={handleMouseDown}
          role='separator'
          aria-orientation='vertical'
          aria-label='Resize panel'
        />
      </aside>

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Workflow</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {currentWorkflow?.name ?? 'this workflow'}
              </span>
              ?{' '}
              <span className='text-[var(--text-error)]'>
                All associated blocks, executions, and configuration will be removed.
              </span>{' '}
              <span className='text-[var(--text-tertiary)]'>
                You can restore it from Recently Deleted in Settings.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteWorkflow} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Floating Variables Modal */}
      <Variables />
    </>
  )
})
