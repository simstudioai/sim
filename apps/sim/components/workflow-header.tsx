'use client'

import { isCollaborationEnabled } from '@/lib/environment'
import { useWorkflowOperationsSafe } from '@/contexts/workflow-operation-context'
import { useWorkflowSaveState } from '@/hooks/use-workflow-save-state'
import { WorkflowSaveButton, WorkflowSaveShortcut } from './workflow-save-button'

interface WorkflowHeaderProps {
  workflowId: string
  className?: string
}

/**
 * Workflow header component that conditionally shows save button
 * based on collaboration settings
 */
export function WorkflowHeader({ workflowId, className }: WorkflowHeaderProps) {
  const { operationManager, isCollaborative, isReady, localOperations } =
    useWorkflowOperationsSafe()
  const saveState = useWorkflowSaveState(localOperations || null)

  const collaborationEnabled = isCollaborationEnabled()

  // Don't render anything if operations aren't ready
  if (!isReady || !operationManager) {
    return null
  }

  // For collaborative mode, show connection status
  if (collaborationEnabled && isCollaborative) {
    return (
      <div className={className}>
        <div className='flex items-center gap-2 text-muted-foreground text-sm'>
          <div className='flex items-center gap-1'>
            <div
              className={`h-2 w-2 rounded-full ${operationManager.isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {operationManager.isConnected ? 'Connected' : 'Disconnected'}
          </div>
          {operationManager.currentWorkflowId && <span>• Collaborative editing enabled</span>}
        </div>
      </div>
    )
  }

  // For non-collaborative mode, show save button
  return (
    <div className={className}>
      <div className='flex items-center gap-2'>
        <WorkflowSaveButton
          isDirty={saveState.isDirty}
          isSaving={saveState.isSaving}
          error={saveState.error}
          onSave={saveState.save}
          onClearError={saveState.clearError}
        />

        {saveState.lastSaved && (
          <span className='text-muted-foreground text-sm'>
            Last saved: {new Date(saveState.lastSaved).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Keyboard shortcut for save */}
      <WorkflowSaveShortcut
        onSave={saveState.save}
        enabled={saveState.isDirty && !saveState.isSaving}
      />
    </div>
  )
}
