'use client'

import { memo, useCallback } from 'react'
import { Square } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { Button, Play, Tooltip } from '@/components/emcn'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { Deploy } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components'
import { useUsageLimits } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/hooks'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Compact floating toolbar at the top-right of the canvas.
 * Contains only the two primary workflow actions: Run and Deploy.
 *
 * All secondary actions (auto layout, variables, history, lock, export,
 * duplicate, delete) live in the left-side WorkflowActions toolbar.
 */
interface WorkflowToolbarProps {
  workspaceId?: string
}

export const WorkflowToolbar = memo(function WorkflowToolbar({
  workspaceId: propWorkspaceId,
}: WorkflowToolbarProps) {
  const params = useParams()
  const workspaceId = propWorkspaceId ?? (params.workspaceId as string)

  const userPermissions = useUserPermissionsContext()
  const { activeWorkflowId, hydration } = useWorkflowRegistry(
    useShallow((state) => ({
      activeWorkflowId: state.activeWorkflowId,
      hydration: state.hydration,
    }))
  )
  const isRegistryLoading = hydration.phase === 'idle' || hydration.phase === 'state-loading'
  const { navigateToSettings } = useSettingsNavigation()

  const { usageExceeded } = useUsageLimits({
    context: 'user',
    autoRefresh: !isRegistryLoading,
  })

  const { handleRunWorkflow, handleCancelExecution, isExecuting } = useWorkflowExecution()

  const cancelWorkflow = useCallback(async () => {
    await handleCancelExecution()
  }, [handleCancelExecution])

  const runWorkflow = useCallback(async () => {
    if (usageExceeded) {
      navigateToSettings({ section: 'subscription' })
      return
    }
    await handleRunWorkflow()
  }, [usageExceeded, handleRunWorkflow, navigateToSettings])

  const canRun = userPermissions.canRead
  const isLoadingPermissions = userPermissions.isLoading
  const isButtonDisabled = !isExecuting && (isExecuting || (!canRun && !isLoadingPermissions))

  return (
    <div className='absolute top-4 right-4 z-10 flex h-[36px] items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1'>
      {/* Run (secondary) */}
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            className='h-[28px] gap-1.5 rounded-md px-2.5'
            data-tour='run-button'
            variant={isExecuting ? 'active' : 'default'}
            onClick={isExecuting ? cancelWorkflow : () => runWorkflow()}
            disabled={!isExecuting && isButtonDisabled}
          >
            {isExecuting ? (
              <Square className='h-[11px] w-[11px] fill-current' />
            ) : (
              <Play className='h-[11px] w-[11px]' />
            )}
            {isExecuting ? 'Stop' : 'Run'}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
          <Tooltip.Shortcut keys='⌘↵'>Run workflow</Tooltip.Shortcut>
        </Tooltip.Content>
      </Tooltip.Root>

      <div className='mx-0.5 h-[20px] w-[1px] bg-[var(--border)]' />

      {/* Deploy (primary CTA) */}
      <div data-tour='deploy-run'>
        <Deploy activeWorkflowId={activeWorkflowId} userPermissions={userPermissions} />
      </div>
    </div>
  )
})
