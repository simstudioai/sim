'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
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
        className="sm:max-w-[1100px] max-h-[100vh] overflow-y-auto"
        style={{
          zIndex: 1000,
          
        }}
      >
        <DialogHeader>
          <DialogTitle>Workflow Deployment View</DialogTitle>
          <DialogDescription>This is the currently deployed version of your workflow.</DialogDescription>
        </DialogHeader>
        <DeployedWorkflowCard
          currentWorkflowState={currentWorkflowState}
          deployedWorkflowState={deployedWorkflowState}
        />
        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
} 