'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DeployedWorkflowCard } from './deployed-workflow-card'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
  // Get current workflow state to compare with deployed state
  const currentWorkflowState = useWorkflowStore((state) => ({
    blocks: state.blocks,
    edges: state.edges,
    loops: state.loops,
  }))

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="sm:max-w-[900px] max-h-[80vh] overflow-y-auto"
        style={{
          zIndex: 1000,
          
        }}
      >
        <DialogHeader>
          <DialogTitle>Workflow Deployment View</DialogTitle>
        </DialogHeader>
        <DeployedWorkflowCard
          currentWorkflowState={currentWorkflowState}
          deployedWorkflowState={deployedWorkflowState}
        />
      </DialogContent>
    </Dialog>
  )
} 