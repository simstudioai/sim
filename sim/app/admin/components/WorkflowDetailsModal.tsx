'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WorkflowLogsModal } from './WorkflowLogsModal'
import { useState, useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatBlockName } from './block-utils'
import { getBlocksFromState } from '@/lib/utils/workflow-utils'

// Define a more specific type for block data
interface BlockData {
  [key: string]: string | number | boolean | null | undefined
}

interface WorkflowBlock {
  id: string
  type: string
  data?: BlockData
}

interface WorkflowDetailsModalProps {
  workflow: {
    id: string
    name: string
    ownerName: string
    blockCount: number
    runCount: number
    isDeployed: boolean
    state?: {
      blocks: WorkflowBlock[]
    }
  } | null
  isOpen: boolean
  onClose: () => void
}

export function WorkflowDetailsModal({ workflow, isOpen, onClose }: WorkflowDetailsModalProps) {
  const [showLogs, setShowLogs] = useState(false)

  // Extract unique block types and their counts using useMemo to avoid recalculation on every render
  const blockTypes = useMemo(() => {
    if (!workflow || !workflow.state) return {}
    
    return getBlocksFromState(workflow.state).reduce<{ [key: string]: number }>((acc, block) => {
      // Validate that block.type exists before using it
      if (block && typeof block.type === 'string') {
        const type = block.type
        acc[type] = (acc[type] || 0) + 1
      }
      return acc
    }, {})
  }, [workflow?.state]) // Only recalculate when workflow.state changes

  if (!workflow) return null

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Workflow Details</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
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

            {Object.keys(blockTypes).length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Blocks Used</h3>
                <ScrollArea className="h-[120px] rounded-md border">
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(blockTypes)
                        .sort(([, a], [, b]) => b - a)
                        .map(([type, count]) => (
                          <div 
                            key={type} 
                            className="flex items-center justify-between p-2 rounded-lg bg-accent/50"
                          >
                            <span className="text-sm font-medium">{formatBlockName(type)}</span>
                            <Badge variant="secondary" className="ml-2 bg-background">
                              {count}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </div>
                </ScrollArea>
              </div>
            )}

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