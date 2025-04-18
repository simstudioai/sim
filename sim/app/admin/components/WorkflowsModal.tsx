'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { WorkflowDetailsModal } from './WorkflowDetailsModal'

// Define a more specific type for block data
interface BlockData {
  [key: string]: string | number | boolean | null | undefined
}

interface WorkflowBlock {
  id: string
  type: string
  data?: BlockData
}

interface Workflow {
  id: string
  name: string
  ownerName: string
  blockCount: number
  runCount: number
  isDeployed: boolean
  state?: {
    blocks: WorkflowBlock[]
  }
}

interface WorkflowsModalProps {
  isOpen: boolean
  onClose: () => void
  workflows: Workflow[]
}

export default function WorkflowsModal({ isOpen, onClose, workflows }: WorkflowsModalProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null)

  const handleWorkflowClick = (workflow: Workflow) => {
    setSelectedWorkflow(workflow)
  }

  // Handle dialog open state change
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      // Reset selected workflow when dialog is closed
      setSelectedWorkflow(null)
    }
    onClose()
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>All Workflows</DialogTitle>
          </DialogHeader>

          {workflows.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground">
              No workflows found
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Blocks</TableHead>
                  <TableHead>Run Count</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((workflow) => (
                  <TableRow 
                    key={workflow.id}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => handleWorkflowClick(workflow)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleWorkflowClick(workflow)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`View details for workflow ${workflow.name}`}
                  >
                    <TableCell>{workflow.name}</TableCell>
                    <TableCell>{workflow.ownerName}</TableCell>
                    <TableCell>{workflow.blockCount}</TableCell>
                    <TableCell>{workflow.runCount}</TableCell>
                    <TableCell>
                      <Badge 
                        variant={workflow.isDeployed ? "default" : "secondary"}
                        className={workflow.isDeployed ? "bg-green-500/10 text-green-500 hover:bg-green-500/20" : ""}
                      >
                        {workflow.isDeployed ? 'Deployed' : 'Not Deployed'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      <WorkflowDetailsModal
        workflow={selectedWorkflow}
        isOpen={!!selectedWorkflow}
        onClose={() => setSelectedWorkflow(null)}
      />
    </>
  )
} 