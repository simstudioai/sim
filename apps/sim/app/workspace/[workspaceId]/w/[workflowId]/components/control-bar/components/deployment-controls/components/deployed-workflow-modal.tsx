'use client'

import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console/logger'
import { DeployedWorkflowCard } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deployment-controls/components/deployed-workflow-card'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployedWorkflowModal')

interface DeployedWorkflowModalProps {
  isOpen: boolean
  onClose: () => void
  needsRedeployment: boolean
  activeDeployedState?: WorkflowState
  selectedDeployedState?: WorkflowState
  selectedVersion?: number
  onActivateVersion?: () => void
  isActivating?: boolean
  selectedVersionLabel?: string
  workflowId: string
}

export function DeployedWorkflowModal({
  isOpen,
  onClose,
  needsRedeployment,
  activeDeployedState,
  selectedDeployedState,
  selectedVersion,
  onActivateVersion,
  isActivating,
  selectedVersionLabel,
  workflowId,
}: DeployedWorkflowModalProps) {
  const [showRevertDialog, setShowRevertDialog] = useState(false)
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Get current workflow state to compare with deployed state
  const currentWorkflowState = useWorkflowStore((state) => ({
    blocks: activeWorkflowId ? mergeSubblockState(state.blocks, activeWorkflowId) : state.blocks,
    edges: state.edges,
    loops: state.loops,
    parallels: state.parallels,
  }))

  const handleRevert = async () => {
    if (!activeWorkflowId) {
      logger.error('Cannot revert: no active workflow ID')
      return
    }

    try {
      const versionToRevert = selectedVersion !== undefined ? selectedVersion : 'active'
      const response = await fetch(
        `/api/workflows/${workflowId}/deployments/${versionToRevert}/revert`,
        {
          method: 'POST',
        }
      )

      if (!response.ok) {
        throw new Error('Failed to revert to version')
      }

      setShowRevertDialog(false)
      onClose()
    } catch (error) {
      logger.error('Failed to revert workflow:', error)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className='max-h-[100vh] overflow-y-auto sm:max-w-[1100px]'
        style={{ zIndex: 1000 }}
        hideCloseButton={true}
      >
        <div className='sr-only'>
          <DialogHeader>
            <DialogTitle>Deployed Workflow</DialogTitle>
          </DialogHeader>
        </div>
        <DeployedWorkflowCard
          currentWorkflowState={currentWorkflowState}
          activeDeployedWorkflowState={activeDeployedState}
          selectedDeployedWorkflowState={selectedDeployedState}
          selectedVersionLabel={selectedVersionLabel}
        />

        <div className='mt-6 flex justify-between'>
          {(needsRedeployment || selectedVersion !== undefined) && (
            <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
              <AlertDialogTrigger asChild>
                <Button variant='destructive'>Revert to Deployment</Button>
              </AlertDialogTrigger>
              <AlertDialogContent style={{ zIndex: 1001 }} className='sm:max-w-[425px]'>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revert to this Version?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will replace your current workflow with the deployed version. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRevert}
                    className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  >
                    Revert
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <div className='ml-auto flex items-center gap-2'>
            {onActivateVersion && (
              <Button onClick={onActivateVersion} disabled={!!isActivating}>
                {isActivating ? 'Activating…' : 'Activate'}
              </Button>
            )}
            <Button variant='outline' onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
