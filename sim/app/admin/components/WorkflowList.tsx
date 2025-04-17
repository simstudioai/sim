'use client'

import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatBlockName } from './block-utils'
import { Workflow as BaseWorkflow } from '@/app/api/admin/dashboard/types'

interface CursorPosition {
  x: number
  y: number
}

interface ExtendedWorkflow extends BaseWorkflow {
  is_deployed?: boolean
  run_count?: number
  variables?: string[]
}

interface WorkflowListProps {
  workflows: ExtendedWorkflow[]
  loading: boolean
}

export default function WorkflowList({ workflows, loading }: WorkflowListProps) {
  const [hoveredWorkflow, setHoveredWorkflow] = useState<ExtendedWorkflow | null>(null)
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ x: 0, y: 0 })

  const handleMouseMove = (e: React.MouseEvent) => {
    setCursorPosition({ x: e.clientX, y: e.clientY })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (!workflows || workflows.length === 0) {
    return <p className="text-sm text-muted-foreground">No workflows found</p>
  }

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-4">
        {workflows.map((workflow) => (
          <div
            key={workflow.id}
            className="flex items-center justify-between border-b pb-2 last:border-0 cursor-pointer hover:bg-accent/50 rounded-lg p-2 transition-colors"
            onMouseEnter={() => setHoveredWorkflow(workflow)}
            onMouseLeave={() => setHoveredWorkflow(null)}
            onMouseMove={handleMouseMove}
          >
            <div>
              <p className="font-medium">{workflow.name || workflow.id}</p>
              <p className="text-sm text-muted-foreground">
                Created: {new Date(workflow.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              {workflow.blocks.length} blocks
            </div>
          </div>
        ))}
      </div>

      {/* Floating Tooltip */}
      {hoveredWorkflow && (
        <div
          className={cn(
            "fixed z-50 p-4 rounded-lg shadow-lg",
            "bg-popover border border-border",
            "pointer-events-none transition-opacity duration-200",
            "text-popover-foreground",
            "max-w-sm"
          )}
          style={{
            left: `${cursorPosition.x}px`,
            top: `${cursorPosition.y - 10}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="space-y-3">
            <div>
              <h4 className="font-medium">{hoveredWorkflow.name || hoveredWorkflow.id}</h4>
              <p className="text-sm text-muted-foreground">
                Created: {new Date(hoveredWorkflow.created_at).toLocaleString()}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Blocks Used:</p>
              <div className="grid grid-cols-2 gap-1">
                {hoveredWorkflow.blocks.map((block, index) => (
                  <p key={index} className="text-xs text-muted-foreground">
                    • {formatBlockName(block.type)}
                  </p>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="font-medium">Deployment Status:</p>
                <p className="text-muted-foreground">
                  {hoveredWorkflow.is_deployed ? 'Deployed' : 'Not Deployed'}
                </p>
              </div>
              <div>
                <p className="font-medium">Run Count:</p>
                <p className="text-muted-foreground">
                  {hoveredWorkflow.run_count || 0} executions
                </p>
              </div>
            </div>

            {hoveredWorkflow.variables && hoveredWorkflow.variables.length > 0 && (
              <div>
                <p className="text-sm font-medium">Variables Used:</p>
                <div className="grid grid-cols-2 gap-1">
                  {hoveredWorkflow.variables.map((variable: string, index: number) => (
                    <p key={index} className="text-xs text-muted-foreground">
                      • {variable}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ScrollArea>
  )
} 