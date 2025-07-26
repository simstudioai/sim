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
  deployedWorkflowState: WorkflowState
}

export function DeployedWorkflowModal({
  isOpen,
  onClose,
  needsRedeployment,
  deployedWorkflowState,
}: DeployedWorkflowModalProps) {
  const [showRevertDialog, setShowRevertDialog] = useState(false)
  const { revertToDeployedState } = useWorkflowStore()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Get current workflow state to compare with deployed state
  const currentWorkflowState = useWorkflowStore((state) => ({
    blocks: activeWorkflowId ? mergeSubblockState(state.blocks, activeWorkflowId) : state.blocks,
    edges: state.edges,
    loops: state.loops,
    parallels: state.parallels,
  }))

  const handleRevert = () => {
    if (activeWorkflowId) {
      revertToDeployedState(deployedWorkflowState)
      setShowRevertDialog(false)
      onClose()
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
          deployedWorkflowState={deployedWorkflowState}
        />

        <div className='mt-6 flex justify-between'>
          {needsRedeployment && (
            <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
              <AlertDialogTrigger asChild>
                <Button variant='destructive'>Revert to Deployed</Button>
              </AlertDialogTrigger>
              <AlertDialogContent style={{ zIndex: 1001 }} className='sm:max-w-[425px]'>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revert to Deployed Version?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will replace your current workflow with the deployed version. Any unsaved
                    changes will be lost. This action cannot be undone.
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

          <Button variant='outline' onClick={onClose} className='ml-auto'>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
