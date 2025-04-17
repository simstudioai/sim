import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WorkflowLogsModal } from './WorkflowLogsModal'
import { useState } from 'react'

interface WorkflowDetailsModalProps {
  workflow: {
    id: string
    name: string
    ownerName: string
    blockCount: number
    runCount: number
    isDeployed: boolean
  } | null
  isOpen: boolean
  onClose: () => void
}

export function WorkflowDetailsModal({ workflow, isOpen, onClose }: WorkflowDetailsModalProps) {
  const [showLogs, setShowLogs] = useState(false)

  if (!workflow) return null

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Workflow Details</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Name</h3>
                <p className="mt-1 text-lg font-semibold">{workflow.name}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Owner</h3>
                <p className="mt-1 text-lg font-semibold">{workflow.ownerName}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Block Count</h3>
                <p className="mt-1 text-lg font-semibold">{workflow.blockCount}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Run Count</h3>
                <p className="mt-1 text-lg font-semibold">{workflow.runCount}</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Status</h3>
              <div className="mt-1">
                <Badge 
                  variant={workflow.isDeployed ? "default" : "secondary"}
                  className={workflow.isDeployed ? "bg-green-500/10 text-green-500 hover:bg-green-500/20" : ""}
                >
                  {workflow.isDeployed ? 'Deployed' : 'Not Deployed'}
                </Badge>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button variant="outline" onClick={() => setShowLogs(true)}>
                View Logs
              </Button>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <WorkflowLogsModal
        workflowId={workflow.id}
        isOpen={showLogs}
        onClose={() => setShowLogs(false)}
      />
    </>
  )
} 