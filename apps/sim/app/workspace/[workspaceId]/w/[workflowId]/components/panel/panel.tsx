'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  BubbleChatClose,
  BubbleChatPreview,
  Button,
  ChipConfirmModal,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Duplicate,
  Layout,
  MoreHorizontal,
  Play,
  Trash,
  toast,
} from '@/components/emcn'
import { Download, Lock, Square, Unlock } from '@/components/emcn/icons'
import { VariableIcon } from '@/components/icons'
import { generateWorkflowJson } from '@/lib/workflows/operations/import-export'
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
import { useFolderMap } from '@/hooks/queries/folders'
import { isWorkflowEffectivelyLocked } from '@/hooks/queries/utils/folder-tree'
import { useDuplicateWorkflowMutation, useWorkflowMap } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useChatStore } from '@/stores/chat/store'
import type { PanelTab } from '@/stores/panel'
import { usePanelStore } from '@/stores/panel'
import { useVariablesModalStore } from '@/stores/variables/modal'
import { useVariablesStore } from '@/stores/variables/store'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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

  // State
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAutoLayouting, setIsAutoLayouting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Hooks
  const userPermissions = useUserPermissionsContext()
  const { isImporting, handleFileChange } = useImportWorkflow({ workspaceId })
  const duplicateWorkflowMutation = useDuplicateWorkflowMutation()
  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
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
    navigateToSettings({ section: 'billing' })
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
  const workflowLocked = isWorkflowEffectivelyLocked(currentWorkflow, folders)
  const canMutateWorkflow = userPermissions.canEdit && !workflowLocked
  const { isSnapshotView } = useCurrentWorkflow()

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
    if (isExecuting || !canMutateWorkflow || isAutoLayouting) {
      return
    }

    setIsAutoLayouting(true)
    try {
      const result = await autoLayoutWithFitView()
      if (!result.success && result.error) {
        toast({ message: result.error })
      }
    } finally {
      setIsAutoLayouting(false)
    }
  }, [isExecuting, canMutateWorkflow, isAutoLayouting, autoLayoutWithFitView])

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
                  <Button className='size-[30px] rounded-[5px]'>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' side='bottom' sideOffset={8}>
                  <DropdownMenuItem
                    onSelect={handleAutoLayout}
                    disabled={
                      isExecuting || !canMutateWorkflow || isAutoLayouting || hasLockedBlocks
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
                    <DropdownMenuItem
                      onSelect={handleToggleWorkflowLock}
                      disabled={!hasBlocks || workflowLocked}
                      title={
                        workflowLocked
                          ? 'Workflow is locked at the row or folder level — release it from the workflow notification or folder menu'
                          : undefined
                      }
                    >
                      {allBlocksLocked ? <Unlock /> : <Lock />}
                      {allBlocksLocked ? 'Unlock workflow' : 'Lock workflow'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={handleExportJson}
                    disabled={!userPermissions.canEdit || isExporting || !currentWorkflow}
                  >
                    <Download />
                    Export workflow
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handleDuplicateWorkflow}
                    disabled={!userPermissions.canEdit || isDuplicating}
                  >
                    <Duplicate />
                    Duplicate workflow
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setIsDeleteModalOpen(true)
                    }}
                    disabled={!canMutateWorkflow || Object.keys(workflows).length <= 1}
                  >
                    <Trash />
                    Delete workflow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                className='size-[30px] rounded-[5px]'
                variant={isChatOpen ? 'active' : 'default'}
                onClick={() => setIsChatOpen(!isChatOpen)}
              >
                {isChatOpen ? <BubbleChatClose /> : <BubbleChatPreview />}
              </Button>
            </div>

            {/* Deploy and Run */}
            <div className='flex gap-1.5'>
              <Deploy
                activeWorkflowId={activeWorkflowId}
                userPermissions={userPermissions}
                disabled={workflowLocked}
              />
              <Button
                className='h-[30px] gap-2 px-2.5'
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
              <Button
                className={`h-[28px] rounded-md border px-2 py-[5px] text-[12.5px] ${
                  _hasHydrated && activeTab === 'toolbar'
                    ? 'border-[var(--border-1)]'
                    : 'border-transparent hover-hover:border-[var(--border-1)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
                }`}
                variant={_hasHydrated && activeTab === 'toolbar' ? 'active' : 'ghost'}
                onClick={() => handleTabClick('toolbar')}
                data-tab-button='toolbar'
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
              >
                Editor
              </Button>
            </div>
          </div>

          {/* Tab Content - Keep all tabs mounted but hidden to preserve state */}
          <div className='flex-1 overflow-hidden pt-3'>
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
      <ChipConfirmModal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        srTitle='Delete Workflow'
        title='Delete Workflow'
        description={
          <>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {currentWorkflow?.name ?? 'this workflow'}
            </span>
            ?{' '}
            <span className='text-[var(--text-error)]'>
              All associated blocks, executions, and configuration will be removed.
            </span>{' '}
            You can restore it from Recently Deleted in Settings.
          </>
        }
        confirm={{
          label: 'Delete',
          onClick: handleDeleteWorkflow,
          pending: isDeleting,
          pendingLabel: 'Deleting...',
        }}
      />

      {/* Floating Variables Modal */}
      <Variables readOnly={workflowLocked} />
    </>
  )
})
