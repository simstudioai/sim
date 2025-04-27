'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { DeployedWorkflowCard } from './deployed-workflow-card'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useState } from 'react'

interface DeployedWorkflowModalProps {
  isOpen: boolean
  onClose: () => void
  deployedWorkflowState: {
    blocks: Record<string, any>
    edges: Array<any>
    loops: Record<string, any>
  }
}

export function DeployedWorkflowModal({
  isOpen,
  onClose,
  deployedWorkflowState,
}: DeployedWorkflowModalProps) {
  const [showRevertDialog, setShowRevertDialog] = useState(false)
  const { revertToDeployedState } = useWorkflowStore()

  // Get current workflow state to compare with deployed state
  const currentWorkflowState = useWorkflowStore((state) => ({
    blocks: state.blocks,
    edges: state.edges,
    loops: state.loops,
  }))

  const handleRevert = () => {
    revertToDeployedState(deployedWorkflowState)
    setShowRevertDialog(false)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="sm:max-w-[1100px] max-h-[100vh] overflow-y-auto"
        style={{ zIndex: 1000 }}
      >
        <DialogHeader>
          <DialogTitle>Workflow Deployment View</DialogTitle>
          <DialogDescription>This is the currently deployed version of your workflow.</DialogDescription>
        </DialogHeader>
        
        <DeployedWorkflowCard
          currentWorkflowState={currentWorkflowState}
          deployedWorkflowState={deployedWorkflowState}
        />

        <div className="flex justify-between mt-6">
          <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                Revert to Deployed
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              style={{ zIndex: 1001 }}
              className="sm:max-w-[425px]"
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Revert to Deployed Version?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will replace your current workflow with the deployed version. 
                  Any unsaved changes will be lost. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleRevert} 
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Revert
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
} 