'use client'

import { memo, useCallback, useRef } from 'react'
import { Chip, cn, toast } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { useParams } from 'next/navigation'
import { ThinkingLoader } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { getWorkspaceUsageLimitAction } from '@/lib/billing/workspace-permissions'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
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
import {
  WorkflowControls,
  WorkflowHistoryControls,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-controls/workflow-controls'
import { WorkflowOptionsMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-controls/workflow-options-menu'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useFolderMap } from '@/hooks/queries/folders'
import { isWorkflowEffectivelyLocked } from '@/hooks/queries/utils/folder-tree'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { PANEL_WIDTH } from '@/stores/constants'
import { usePanelEditorStore, usePanelStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface PanelProps {
  onCloseEditor?: () => void
}

/**
 * Workflow header and contextual right panel. The panel automatically shows the block
 * library when the canvas has no selection and the editor when a block is selected.
 *
 * @returns Structured workflow chrome around the canvas
 */
export const Panel = memo(function Panel({ onCloseEditor }: PanelProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const panelRef = useRef<HTMLElement>(null)
  const setActiveTab = usePanelStore((state) => state.setActiveTab)
  const toolbarRef = useRef<{
    focusSearch: () => void
  } | null>(null)
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()

  // Hooks
  const userPermissions = useUserPermissionsContext()

  const currentBlockId = usePanelEditorStore((state) => state.currentBlockId)
  const showEditor = currentBlockId !== null

  const { data: workflows = {} } = useWorkflowMap(workspaceId)
  const { data: folders = {} } = useFolderMap(workspaceId)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { navigateToSettings } = useSettingsNavigation()

  // Usage limits hook
  const {
    usageExceeded,
    message: usageLimitMessage,
    scope: usageLimitScope,
    isLoading: isUsageGateLoading,
  } = useUsageLimits({ workspaceId })

  // Workflow execution hook
  const { handleRunWorkflow, handleCancelExecution, isExecuting } = useWorkflowExecution()

  // Panel resize hook
  const { handleKeyDown, handlePointerDown, maxPanelWidth, panelWidth } = usePanelResize()

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
    if (isUsageGateLoading) return

    if (usageExceeded) {
      const action = getWorkspaceUsageLimitAction(hostContext, session?.user?.id, {
        message: usageLimitMessage,
        scope: usageLimitScope,
      })
      if (action.type === 'manage-billing') {
        openSubscriptionSettings()
      } else {
        toast.error(action.message)
      }
      return
    }
    await handleRunWorkflow()
  }, [
    usageExceeded,
    usageLimitMessage,
    usageLimitScope,
    isUsageGateLoading,
    hostContext,
    session?.user?.id,
    handleRunWorkflow,
  ])

  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null
  const workflowLocked = isWorkflowEffectivelyLocked(currentWorkflow, folders)

  const handleCloseEditor = useCallback(() => {
    if (onCloseEditor) {
      onCloseEditor()
    } else {
      usePanelEditorStore.getState().clearCurrentBlock()
    }
    setActiveTab('toolbar')
  }, [onCloseEditor, setActiveTab])

  const handleFocusToolbarSearch = useCallback(() => {
    usePanelEditorStore.getState().clearCurrentBlock()
    setActiveTab('toolbar')
    requestAnimationFrame(() => toolbarRef.current?.focusSearch())
  }, [setActiveTab])

  // Compute run button state
  const canRun = userPermissions.canRead // Running only requires read permissions
  const isLoadingPermissions = userPermissions.isLoading
  const hasValidationErrors = false // TODO: Add validation logic if needed
  const isWorkflowBlocked = isExecuting || hasValidationErrors
  const isButtonDisabled =
    !isExecuting && (isUsageGateLoading || isWorkflowBlocked || (!canRun && !isLoadingPermissions))

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
        handler: handleFocusToolbarSearch,
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  return (
    <>
      <header className='workflow-header pointer-events-none absolute inset-x-0 top-0 z-30 flex h-[40px] items-stretch border-[var(--border)] border-b'>
        <div className='pointer-events-auto flex min-w-0 flex-1 items-center gap-3 bg-[var(--bg)] px-3'>
          <div className='flex min-w-0 flex-1 items-center gap-1'>
            <h1 className='min-w-0 truncate text-[var(--text-body)] text-sm'>
              {currentWorkflow?.name ?? 'Untitled workflow'}
            </h1>
            <WorkflowOptionsMenu isExecuting={isExecuting} />
          </div>
          <WorkflowHistoryControls />
          <WorkflowControls />
        </div>
        <div
          className={cn(
            'pointer-events-none flex w-[var(--panel-width)] flex-shrink-0 items-center border-[var(--border)] border-l pr-1 pl-3.5',
            showEditor ? 'justify-between bg-[var(--bg)]' : 'justify-end'
          )}
        >
          {showEditor && (
            <button
              type='button'
              className='pointer-events-auto flex h-10 min-w-0 flex-1 items-center gap-2 p-0 text-left outline-none focus-visible:underline'
              onClick={handleFocusToolbarSearch}
              aria-label='Search blocks'
            >
              <Search className='size-[14px] flex-shrink-0 text-[var(--text-muted)]' />
              <span className='min-w-0 truncate text-[var(--text-muted)] text-sm'>
                Search blocks...
              </span>
            </button>
          )}
          <div className='pointer-events-auto flex items-center gap-1.5'>
            <Deploy
              activeWorkflowId={activeWorkflowId}
              userPermissions={userPermissions}
              disabled={workflowLocked}
            />
            <Chip
              className='h-[32px]'
              variant={isExecuting ? undefined : 'primary'}
              active={isExecuting}
              onClick={isExecuting ? cancelWorkflow : () => runWorkflow()}
              disabled={!isExecuting && isButtonDisabled}
              aria-label={isExecuting ? 'Stop workflow' : 'Run workflow'}
              leftAdornment={
                <span
                  aria-hidden='true'
                  className='inline-flex size-5 flex-shrink-0 items-center justify-center overflow-visible'
                >
                  <ThinkingLoader
                    variant={isExecuting ? undefined : 'play'}
                    startVariant='play'
                    startHoldMs={140}
                    size={20}
                    morphDurationMs={isExecuting ? 650 : 180}
                    tone='inherit'
                  />
                </span>
              }
            >
              <span className='inline-grid'>
                <span aria-hidden='true' className='invisible col-start-1 row-start-1'>
                  Stop
                </span>
                <span className='col-start-1 row-start-1'>{isExecuting ? 'Stop' : 'Run'}</span>
              </span>
            </Chip>
          </div>
        </div>
      </header>

      <div
        className={cn(
          'workflow-right-tools pointer-events-none absolute right-0 bottom-0 z-20 flex w-[var(--panel-width)] [container-type:size]',
          showEditor ? 'top-[40px]' : 'top-0'
        )}
      >
        <aside
          ref={panelRef}
          className='panel-container pointer-events-auto relative flex h-full min-h-0 flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)]'
          aria-label='Workflow panel'
        >
          <div className='flex h-full min-h-0 flex-col'>
            <div
              className={cn(
                'min-h-0 overflow-hidden',
                showEditor ? 'flex flex-1 flex-col' : 'flex-1'
              )}
            >
              {showEditor ? (
                <div className='flex h-full min-h-0 flex-col overflow-hidden'>
                  <Editor onClose={handleCloseEditor} />
                </div>
              ) : (
                <div className='flex h-full flex-col'>
                  <div className='min-h-0 flex-1'>
                    <Toolbar ref={toolbarRef} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            className="before:-translate-x-1/2 absolute top-0 bottom-0 left-[-4px] z-20 w-[8px] cursor-ew-resize before:absolute before:inset-y-0 before:left-1/2 before:w-[2px] before:bg-[var(--border)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] hover-hover:before:opacity-100 focus-visible:outline-none focus-visible:before:opacity-100 active:before:opacity-100"
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
            role='separator'
            aria-orientation='vertical'
            aria-label='Resize panel'
            aria-valuemin={PANEL_WIDTH.MIN}
            aria-valuemax={maxPanelWidth === null ? undefined : Math.round(maxPanelWidth)}
            aria-valuenow={maxPanelWidth === null ? undefined : Math.round(panelWidth)}
            aria-valuetext={maxPanelWidth === null ? undefined : `${Math.round(panelWidth)} pixels`}
            tabIndex={0}
          />
        </aside>
      </div>

      {/* Floating Variables Modal */}
      <Variables readOnly={workflowLocked} />
    </>
  )
})
