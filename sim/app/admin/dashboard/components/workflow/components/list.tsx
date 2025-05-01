'use client'

import { useState, useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatBlockName } from '../../charts/components/block-utils'
import { getBlocksFromState } from '../../../../analytics/utils/workflow-utils'

interface CursorPosition {
  x: number
  y: number
}

interface TooltipPosition {
  x: number
  y: number
  placement: 'top' | 'bottom' | 'left' | 'right'
}

interface Workflow {
  id: string
  name: string
  created_at: string
  blocks?: Array<{ type: string }>
  blockTypes?: string[]
  is_deployed?: boolean
  run_count?: number
  variables?: string[]
  blockCount?: number
}

interface ExtendedWorkflow extends Workflow {
  is_deployed?: boolean
  run_count?: number
  variables?: string[]
  blockTypes?: string[]
  blockCount?: number
}

interface WorkflowListProps {
  workflows: ExtendedWorkflow[]
  loading: boolean
}

export default function WorkflowList({ workflows, loading }: WorkflowListProps) {
  const [hoveredWorkflow, setHoveredWorkflow] = useState<ExtendedWorkflow | null>(null)
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ x: 0, y: 0 })
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>({ 
    x: 0, 
    y: 0, 
    placement: 'top' 
  })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })

  // Update viewport size on mount and resize
  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      })
    }

    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)
    return () => window.removeEventListener('resize', updateViewportSize)
  }, [])

  const handleMouseMove = (e: React.MouseEvent) => {
    setCursorPosition({ x: e.clientX, y: e.clientY })
  }

  // Calculate optimal tooltip position based on cursor position and viewport boundaries
  useEffect(() => {
    if (!hoveredWorkflow || !tooltipRef.current) return

    const tooltip = tooltipRef.current
    const tooltipRect = tooltip.getBoundingClientRect()
    const padding = 10 // Padding from viewport edges
    
    // Default position (top placement)
    let x = cursorPosition.x
    let y = cursorPosition.y - 10
    let placement: 'top' | 'bottom' | 'left' | 'right' = 'top'
    
    // Check if tooltip would go off the right edge
    if (x + tooltipRect.width / 2 > viewportSize.width - padding) {
      x = viewportSize.width - tooltipRect.width / 2 - padding
    }
    
    // Check if tooltip would go off the left edge
    if (x - tooltipRect.width / 2 < padding) {
      x = tooltipRect.width / 2 + padding
    }
    
    // Check if tooltip would go off the top edge
    if (y - tooltipRect.height < padding) {
      // Switch to bottom placement
      y = cursorPosition.y + 10
      placement = 'bottom'
    }
    
    // Check if tooltip would go off the bottom edge
    if (y + tooltipRect.height > viewportSize.height - padding) {
      // If it would go off the bottom too, try left or right placement
      if (x > viewportSize.width / 2) {
        // Place on the left side of cursor
        x = cursorPosition.x - 10
        y = cursorPosition.y
        placement = 'left'
      } else {
        // Place on the right side of cursor
        x = cursorPosition.x + 10
        y = cursorPosition.y
        placement = 'right'
      }
    }
    
    setTooltipPosition({ x, y, placement })
  }, [cursorPosition, hoveredWorkflow, viewportSize])

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

  const getBlockCount = (workflow: ExtendedWorkflow): number => {
    if (typeof workflow.blockCount === 'number') {
      return workflow.blockCount;
    }
    if (workflow.blockTypes?.length) {
      return workflow.blockTypes.length;
    }
    if (workflow.blocks?.length) {
      return workflow.blocks.length;
    }
    return 0;
  }

  const getBlocksForDisplay = (workflow: ExtendedWorkflow) => {
    if (workflow.blockTypes && workflow.blockTypes.length > 0) {
      return workflow.blockTypes.map(type => ({ type }));
    }
    return workflow.blocks || [];
  }

  // Get transform style based on placement
  const getTransformStyle = () => {
    switch (tooltipPosition.placement) {
      case 'top':
        return 'translate(-50%, -100%)'
      case 'bottom':
        return 'translate(-50%, 0)'
      case 'left':
        return 'translate(-100%, -50%)'
      case 'right':
        return 'translate(0, -50%)'
      default:
        return 'translate(-50%, -100%)'
    }
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
              {getBlockCount(workflow)} blocks
            </div>
          </div>
        ))}
      </div>

      {/* Floating Tooltip */}
      {hoveredWorkflow && (
        <div
          ref={tooltipRef}
          className={cn(
            "fixed z-50 p-4 rounded-lg shadow-lg",
            "bg-popover border border-border",
            "pointer-events-none transition-opacity duration-200",
            "text-popover-foreground",
            "max-w-sm"
          )}
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: getTransformStyle(),
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
                {getBlocksForDisplay(hoveredWorkflow).map((block, index) => (
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