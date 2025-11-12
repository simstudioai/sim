'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Braces, Square } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  BubbleChatPreview,
  Button,
  Copy,
  Layout,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  MoreHorizontal,
  Play,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Trash,
} from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Variables } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/variables/variables'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useDeleteWorkflow } from '@/app/workspace/[workspaceId]/w/hooks'
import { useChatStore } from '@/stores/chat/store'
import { usePanelStore } from '@/stores/panel-new/store'
import type { PanelTab } from '@/stores/panel-new/types'
import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowJsonStore } from '@/stores/workflows/json/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { Copilot, Deploy, Editor, Toolbar } from './components'
import { usePanelResize, useUsageLimits } from './hooks'

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
export function Panel() {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const panelRef = useRef<HTMLElement>(null)
  const { activeTab, setActiveTab, panelWidth, _hasHydrated, setHasHydrated } = usePanelStore()
  const copilotRef = useRef<{
    createNewChat: () => void
    setInputValueAndFocus: (value: string) => void
  }>(null)

  // State
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAutoLayouting, setIsAutoLayouting] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Hooks
  const userPermissions = useUserPermissionsContext()
  const {
    workflows,
    activeWorkflowId,
    duplicateWorkflow,
    isLoading: isRegistryLoading,
  } = useWorkflowRegistry()
  const { getJson } = useWorkflowJsonStore()
  const { blocks } = useWorkflowStore()

  // Delete workflow hook
  const { isDeleting, handleDeleteWorkflow } = useDeleteWorkflow({
    workspaceId,
    getWorkflowIds: () => activeWorkflowId || '',
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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('open-settings', {
          detail: { tab: 'subscription' },
        })
      )
    }
  }

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

  /**
   * Cancels the currently executing workflow
   */
  const cancelWorkflow = useCallback(async () => {
    await handleCancelExecution()
  }, [handleCancelExecution])

  // Chat state
  const { isChatOpen, setIsChatOpen } = useChatStore()
  const { isOpen: isVariablesOpen, setIsOpen: setVariablesOpen } = useVariablesStore()

  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null

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
      // Use the standalone auto layout utility for immediate frontend updates
      const { applyAutoLayoutAndUpdateStore } = await import('../../utils')

      const result = await applyAutoLayoutAndUpdateStore(activeWorkflowId!)

      if (result.success) {
        logger.info('Auto layout completed successfully')
      } else {
        logger.error('Auto layout failed:', result.error)
      }
    } catch (error) {
      logger.error('Auto layout error:', error)
    } finally {
      setIsAutoLayouting(false)
    }
  }, [isExecuting, userPermissions.canEdit, isAutoLayouting, activeWorkflowId])

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
      // Get the JSON from the store
      const jsonContent = await getJson()

      if (!jsonContent) {
        throw new Error('Failed to generate JSON')
      }

      const filename = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.json`
      downloadFile(jsonContent, filename, 'application/json')
      logger.info('Workflow exported as JSON')
    } catch (error) {
      logger.error('Failed to export workflow as JSON:', error)
    } finally {
      setIsExporting(false)
      setIsMenuOpen(false)
    }
  }, [currentWorkflow, activeWorkflowId, getJson, downloadFile])

  /**
   * Handles duplicating the current workflow
   */
  const handleDuplicateWorkflow = useCallback(async () => {
    if (!activeWorkflowId || !userPermissions.canEdit || isDuplicating) {
      return
    }

    setIsDuplicating(true)
    try {
      const newWorkflow = await duplicateWorkflow(activeWorkflowId)
      if (newWorkflow) {
        router.push(`/workspace/${workspaceId}/w/${newWorkflow}`)
      }
    } catch (error) {
      logger.error('Error duplicating workflow:', error)
    } finally {
      setIsDuplicating(false)
      setIsMenuOpen(false)
    }
  }, [
    activeWorkflowId,
    userPermissions.canEdit,
    isDuplicating,
    duplicateWorkflow,
    router,
    workspaceId,
  ])

  // Compute run button state
  const canRun = userPermissions.canRead // Running only requires read permissions
  const isLoadingPermissions = userPermissions.isLoading
  const hasValidationErrors = false // TODO: Add validation logic if needed
  const isWorkflowBlocked = isExecuting || hasValidationErrors
  const isButtonDisabled = !isExecuting && (isWorkflowBlocked || (!canRun && !isLoadingPermissions))

  // Register global keyboard shortcuts
  useRegisterGlobalCommands(() => [
    {
      id: 'run-workflow',
      shortcut: 'Mod+Enter',
      allowInEditable: false,
      handler: () => {
        // Do exactly what the Run button does
        if (isExecuting) {
          cancelWorkflow()
        } else {
          runWorkflow()
        }
      },
    },
  ])

  return (
    <>
      <aside
        ref={panelRef}
        className='panel-container fixed inset-y-0 right-0 z-10 overflow-hidden dark:bg-[var(--surface-1)]'
        aria-label='Workflow panel'
      >
        <div className='flex h-full flex-col border-l pt-[14px] dark:border-[var(--border)]'>
          {/* Header */}
          <div className='flex flex-shrink-0 items-center justify-between px-[8px]'>
            {/* More and Chat */}
            <div className='flex gap-[4px]'>
              <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <PopoverTrigger asChild>
                  <Button className='h-[32px] w-[32px]'>
                    <MoreHorizontal />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align='start' side='bottom' sideOffset={8}>
                  <PopoverItem
                    onClick={handleAutoLayout}
                    disabled={isExecuting || !userPermissions.canEdit || isAutoLayouting}
                  >
                    <Layout className='h-3 w-3' animate={isAutoLayouting} variant='clockwise' />
                    <span>Auto layout</span>
                  </PopoverItem>
                  {
                    <PopoverItem onClick={() => setVariablesOpen(!isVariablesOpen)}>
                      <Braces className='h-3 w-3' />
                      <span>Variables</span>
                    </PopoverItem>
                  }
                  {/* <PopoverItem>
                    <Bug className='h-3 w-3' />
                    <span>Debug</span>
                  </PopoverItem> */}
                  {/* <PopoverItem onClick={() => setIsMenuOpen(false)}>
                    <Webhook className='h-3 w-3' />
                    <span>Log webhook</span>
                  </PopoverItem> */}
                  <PopoverItem
                    onClick={handleExportJson}
                    disabled={isExporting || !currentWorkflow}
                  >
                    <Braces className='h-3 w-3' />
                    <span>Export JSON</span>
                  </PopoverItem>
                  <PopoverItem
                    onClick={handleDuplicateWorkflow}
                    disabled={!userPermissions.canEdit || isDuplicating}
                  >
                    <Copy className='h-3 w-3' animate={isDuplicating} />
                    <span>Duplicate workflow</span>
                  </PopoverItem>
                  <PopoverItem
                    onClick={() => {
                      setIsMenuOpen(false)
                      setIsDeleteModalOpen(true)
                    }}
                    disabled={!userPermissions.canEdit || Object.keys(workflows).length <= 1}
                  >
                    <Trash className='h-3 w-3' />
                    <span>Delete workflow</span>
                  </PopoverItem>
                </PopoverContent>
              </Popover>
              <Button
                className='h-[32px] w-[32px]'
                variant={isChatOpen ? 'active' : 'default'}
                onClick={() => setIsChatOpen(!isChatOpen)}
              >
                <BubbleChatPreview />
              </Button>
            </div>

            {/* Deploy and Run */}
            <div className='flex gap-[4px]'>
              <Deploy activeWorkflowId={activeWorkflowId} userPermissions={userPermissions} />
              <Button
                className='h-[32px] w-[61.5px] gap-[8px]'
                variant={isExecuting ? 'active' : 'primary'}
                onClick={isExecuting ? cancelWorkflow : () => runWorkflow()}
                disabled={!isExecuting && isButtonDisabled}
              >
                {isExecuting ? (
                  <Square className='h-[11.5px] w-[11.5px] fill-current' />
                ) : (
                  <Play className='h-[11.5px] w-[11.5px]' />
                )}
                Run
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className='flex flex-shrink-0 items-center justify-between px-[8px] pt-[14px]'>
            <div className='flex gap-[4px]'>
              <Button
                className='h-[28px] px-[8px] py-[5px] text-[12.5px] hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-9)] dark:hover:text-[var(--text-primary)]'
                variant={_hasHydrated && activeTab === 'copilot' ? 'active' : 'ghost'}
                onClick={() => handleTabClick('copilot')}
                data-tab-button='copilot'
              >
                Copilot
              </Button>
              <Button
                className='h-[28px] px-[8px] py-[5px] text-[12.5px] hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-9)] dark:hover:text-[var(--text-primary)]'
                variant={_hasHydrated && activeTab === 'toolbar' ? 'active' : 'ghost'}
                onClick={() => handleTabClick('toolbar')}
                data-tab-button='toolbar'
              >
                Toolbar
              </Button>
              <Button
                className='h-[28px] px-[8px] py-[5px] text-[12.5px] hover:bg-[var(--surface-9)] hover:text-[var(--text-primary)] dark:hover:bg-[var(--surface-9)] dark:hover:text-[var(--text-primary)]'
                variant={_hasHydrated && activeTab === 'editor' ? 'active' : 'ghost'}
                onClick={() => handleTabClick('editor')}
                data-tab-button='editor'
              >
                Editor
              </Button>
            </div>

            {/* Workflow Controls (Undo/Redo and Zoom) */}
            {/* <WorkflowControls /> */}
          </div>

          {/* Tab Content - Keep all tabs mounted but hidden to preserve state */}
          <div className='flex-1 overflow-hidden pt-[12px]'>
            <div
              className={
                _hasHydrated && activeTab === 'copilot'
                  ? 'h-full'
                  : _hasHydrated
                    ? 'hidden'
                    : 'h-full'
              }
              data-tab-content='copilot'
            >
              <Copilot ref={copilotRef} panelWidth={panelWidth} />
            </div>
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
              <Toolbar isActive={activeTab === 'toolbar'} />
            </div>
          </div>
        </div>
      </aside>

      {/* Resize Handle */}
      <div
        className='fixed top-0 right-[calc(var(--panel-width)-4px)] bottom-0 z-20 w-[8px] cursor-ew-resize'
        onMouseDown={handleMouseDown}
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize panel'
      />

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete workflow?</ModalTitle>
            <ModalDescription>
              Deleting this workflow will permanently remove all associated blocks, executions, and
              configuration.{' '}
              <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                This action cannot be undone.
              </span>
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button
              className='h-[32px] px-[12px]'
              variant='outline'
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
              onClick={handleDeleteWorkflow}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Floating Variables Modal */}
      <Variables />
    </>
  )
}
