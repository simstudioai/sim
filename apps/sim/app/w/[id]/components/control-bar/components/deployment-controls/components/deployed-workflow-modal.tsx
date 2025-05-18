'use client'

import { useEffect, useState, useMemo } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { DeployedWorkflowCard } from './deployed-workflow-card'

const logger = createLogger('DeployedWorkflowModal')

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
  const [isLoading, setIsLoading] = useState(false)
  const { revertToDeployedState } = useWorkflowStore()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  // Add debug logging to check deployedWorkflowState
  useEffect(() => {
    if (isOpen) {
      if (deployedWorkflowState) {
        logger.info(`DeployedWorkflowModal received state with ${Object.keys(deployedWorkflowState.blocks || {}).length} blocks`)
      } else {
        logger.warn('DeployedWorkflowModal opened but deployedWorkflowState is null or undefined')
      }
    }
  }, [isOpen, deployedWorkflowState]);

  // Get current workflow state to compare with deployed state
  const currentWorkflowState = useWorkflowStore((state) => ({
    blocks: activeWorkflowId ? mergeSubblockState(state.blocks, activeWorkflowId) : state.blocks,
    edges: state.edges,
    loops: state.loops,
  }))
  
  // Sanitize states to ensure no invalid blocks are passed to components
  const sanitizedCurrentState = useMemo(() => {
    if (!currentWorkflowState) return undefined;
    
    return {
      blocks: Object.fromEntries(
        Object.entries(currentWorkflowState.blocks || {})
          .filter(([_, block]) => block && block.type)
          .map(([id, block]) => {
            // Deep clone the block to avoid any reference sharing
            return [id, JSON.parse(JSON.stringify(block))];
          })
      ),
      edges: currentWorkflowState.edges ? [...currentWorkflowState.edges] : [],
      loops: currentWorkflowState.loops ? {...currentWorkflowState.loops} : {}
    };
  }, [currentWorkflowState]);
  
  const sanitizedDeployedState = useMemo(() => {
    if (!deployedWorkflowState) return {
      blocks: {},
      edges: [],
      loops: {}
    };
    
    return {
      blocks: Object.fromEntries(
        Object.entries(deployedWorkflowState.blocks || {})
          .filter(([_, block]) => block && block.type)
          .map(([id, block]) => {
            // Deep clone the block to avoid any reference sharing
            return [id, JSON.parse(JSON.stringify(block))];
          })
      ),
      edges: deployedWorkflowState.edges ? [...deployedWorkflowState.edges] : [],
      loops: deployedWorkflowState.loops ? {...deployedWorkflowState.loops} : {}
    };
  }, [deployedWorkflowState]);

  const handleRevert = () => {
    if (activeWorkflowId) {
      logger.info(`Reverting to deployed state for workflow: ${activeWorkflowId}`)
      revertToDeployedState(deployedWorkflowState)
      setShowRevertDialog(false)
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[1100px] max-h-[100vh] overflow-y-auto"
        style={{ zIndex: 1000 }}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideCloseButton={true}
      >
        <div className="sr-only">
          <DialogHeader>
            <DialogTitle>Deployed Workflow</DialogTitle>
          </DialogHeader>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-[500px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <DeployedWorkflowCard
            currentWorkflowState={sanitizedCurrentState}
            deployedWorkflowState={sanitizedDeployedState}
          />
        )}

        <div className="flex justify-between mt-6">
          <AlertDialog open={showRevertDialog} onOpenChange={setShowRevertDialog}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Revert to Deployed</Button>
            </AlertDialogTrigger>
            <AlertDialogContent style={{ zIndex: 1001 }} className="sm:max-w-[425px]">
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
