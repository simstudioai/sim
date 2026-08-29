'use client'

import { memo, useCallback, useEffect, useRef } from 'react'
import { Chip, cn, toast } from '@sim/emcn'
import { useParams, useSearchParams } from 'next/navigation'
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
  EditorPanelActions,
  Logs,
  PanelViewControls,
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
import { useWorkflowRunSnapshotStore } from '@/stores/logs/workflow-run-snapshot'
import { usePanelEditorStore, usePanelStore } from '@/stores/panel'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface PanelProps {
  onCloseEditor?: () => void
}

/**
 * Workflow header and contextual right panel. Toolbar and Editor remain independently
 * available so users can browse blocks without losing their current canvas selection.
 *
 * @returns Structured workflow chrome around the canvas
 */
export const Panel = memo(function Panel({ onCloseEditor }: PanelProps) {
  const params = useParams()
  const searchParams = useSearchParams()
  const workspaceId = params.workspaceId as string
  const logsPrototypeEnabled =
    process.env.NODE_ENV === 'development' && searchParams.get('logsPrototype') === '4'

  const panelRef = useRef<HTMLElement>(null)
  const activeTab = usePanelStore((state) => state.activeTab)
  const setActiveTab = usePanelStore((state) => state.setActiveTab)
  const snapshot = useWorkflowRunSnapshotStore((state) => state.snapshot)
  const closeSnapshot = useWorkflowRunSnapshotStore((state) => state.closeSnapshot)
  const logsPrototypeWasEnabledRef = useRef(false)
  const hasSyncedSnapshotTabRef = useRef(false)
  const toolbarSearchInputRef = useRef<HTMLInputElement>(null)
  const toolbarRef = useRef<{
    focusFirstItem: () => void
    setSearchQuery: (query: string) => void
  } | null>(null)
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()

  // Hooks
  const userPermissions = useUserPermissionsContext()

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
  }, [onCloseEditor])

  const handleFocusToolbarSearch = useCallback(() => {
    setActiveTab('toolbar')
    requestAnimationFrame(() => toolbarSearchInputRef.current?.focus())
  }, [setActiveTab])

  const handleToolbarSearchChange = useCallback((query: string) => {
    toolbarRef.current?.setSearchQuery(query)
  }, [])

  const handleToolbarSearchNavigate = useCallback(() => {
    toolbarRef.current?.focusFirstItem()
  }, [])

  const handleEditorSelect = useCallback(() => {
    toolbarSearchInputRef.current?.blur()
    setActiveTab('editor')
  }, [setActiveTab])

  const handleLogsSelect = useCallback(() => {
    toolbarSearchInputRef.current?.blur()
    setActiveTab('logs')
  }, [setActiveTab])

  useEffect(() => {
    const wasEnabled = logsPrototypeWasEnabledRef.current
    if (logsPrototypeEnabled && !wasEnabled) {
      setActiveTab('logs')
    } else if (!logsPrototypeEnabled && activeTab === 'logs') {
      setActiveTab('toolbar')
    }
    logsPrototypeWasEnabledRef.current = logsPrototypeEnabled
  }, [activeTab, logsPrototypeEnabled, setActiveTab])

  useEffect(() => {
    /**
     * Skip the first commit: the logs tab is selected by the effect above, so on
     * mount `activeTab` still holds the previous tab and closing here would tear
     * down the snapshot the deep-linked run just opened.
     */
    if (!hasSyncedSnapshotTabRef.current) {
      hasSyncedSnapshotTabRef.current = true
      return
    }
    if (!logsPrototypeEnabled || activeTab !== 'logs') {
      closeSnapshot()
    }
  }, [activeTab, closeSnapshot, logsPrototypeEnabled])

  // Compute run button state
  const canRun = userPermissions.canRead // Running only requires read permissions
  const isLoadingPermissions = userPermissions.isLoading
  const hasValidationErrors = false // TODO: Add validation logic if needed
  const isWorkflowBlocked = isExecuting || hasValidationErrors
  const isButtonDisabled =
    Boolean(snapshot) ||
    (!isExecuting &&
      (isUsageGateLoading || isWorkflowBlocked || (!canRun && !isLoadingPermissions)))

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
          if (snapshot) return
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
      <header className='workflow-header pointer-events-none absolute top-0 right-[var(--panel-width)] left-0 z-30 flex h-[40px] items-stretch border-[var(--border)] border-b'>
        <div className='pointer-events-auto flex min-w-0 flex-1 items-center gap-3 bg-[var(--bg)] px-3'>
          <div className='flex min-w-0 flex-1 items-center gap-1'>
            <h1 className='min-w-0 truncate text-[var(--text-body)] text-sm'>
              {currentWorkflow?.name ?? 'Untitled workflow'}
            </h1>
            <WorkflowOptionsMenu isExecuting={isExecuting} />
          </div>
          <WorkflowHistoryControls />
          <WorkflowControls />
          <div className='flex items-center gap-1.5'>
            <Deploy
              activeWorkflowId={activeWorkflowId}
              userPermissions={userPermissions}
              disabled={workflowLocked || Boolean(snapshot)}
            />
            <Chip
              variant={isExecuting ? undefined : 'primary'}
              active={isExecuting}
              onClick={isExecuting ? cancelWorkflow : () => runWorkflow()}
              disabled={isButtonDisabled}
              aria-label={isExecuting ? 'Stop workflow' : 'Run workflow'}
              leftAdornment={
                <span
                  aria-hidden='true'
                  className='inline-flex size-[14px] flex-shrink-0 items-center justify-center overflow-visible'
                >
                  <ThinkingLoader
                    variant={isExecuting ? undefined : 'play'}
                    startVariant='play'
                    startHoldMs={140}
                    size={14}
                    morphDurationMs={isExecuting ? 650 : 180}
                    tone='inherit'
                  />
                </span>
              }
            >
              {isExecuting ? 'Stop' : 'Run'}
            </Chip>
          </div>
        </div>
      </header>

      <div className='workflow-right-tools pointer-events-none absolute top-0 right-0 bottom-0 z-20 flex w-[var(--panel-width)] [container-type:size]'>
        <aside
          ref={panelRef}
          className='panel-container pointer-events-auto relative flex h-full min-h-0 w-full flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)]'
          aria-label='Workflow panel'
        >
          <div className='flex h-full min-h-0 flex-col'>
            <PanelViewControls
              key={activeWorkflowId ?? 'workflow'}
              activeTab={activeTab}
              searchInputRef={toolbarSearchInputRef}
              onSearchChange={handleToolbarSearchChange}
              onSearchNavigate={handleToolbarSearchNavigate}
              onToolbarSelect={handleFocusToolbarSearch}
              onEditorSelect={handleEditorSelect}
              onLogsSelect={handleLogsSelect}
              showLogs={logsPrototypeEnabled}
              editorActions={<EditorPanelActions onClose={handleCloseEditor} />}
            />

            <div className='min-h-0 flex-1 overflow-hidden'>
              <div
                data-tab-content='toolbar'
                className={cn(
                  'h-full min-h-0',
                  activeTab === 'toolbar' ? 'flex flex-col' : 'hidden'
                )}
              >
                <Toolbar
                  key={activeWorkflowId ?? 'workflow'}
                  ref={toolbarRef}
                  isActive={activeTab === 'toolbar'}
                  onFocusSearch={handleFocusToolbarSearch}
                />
              </div>
              <div
                data-tab-content='editor'
                className={cn(
                  'h-full min-h-0 flex-col overflow-hidden',
                  activeTab === 'editor' ? 'flex' : 'hidden'
                )}
              >
                <Editor />
              </div>
              {logsPrototypeEnabled ? (
                <div
                  data-tab-content='logs'
                  className={cn(
                    'h-full min-h-0 flex-col overflow-hidden',
                    activeTab === 'logs' ? 'flex' : 'hidden'
                  )}
                >
                  <Logs />
                </div>
              ) : null}
            </div>
          </div>

          <div
            data-panel-resize-handle=''
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
