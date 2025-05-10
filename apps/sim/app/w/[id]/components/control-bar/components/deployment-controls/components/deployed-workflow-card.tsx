'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/generic-workflow-preview'
import { cn } from '@/lib/utils'

interface DeployedWorkflowCardProps {
  // Current workflow state (if any)
  currentWorkflowState?: {
    blocks: Record<string, any>
    edges: Array<any>
    loops: Record<string, any>
  }
  // Deployed workflow state from Supabase
  deployedWorkflowState: {
    blocks: Record<string, any>
    edges: Array<any>
    loops: Record<string, any>
  }
  // Optional className for styling
  className?: string
}

export function DeployedWorkflowCard({
  currentWorkflowState,
  deployedWorkflowState,
  className,
}: DeployedWorkflowCardProps) {
  // State for toggling between deployed and current workflow
  const [showingDeployed, setShowingDeployed] = useState(true)

  // Determine which workflow state to show
  const workflowToShow = showingDeployed ? deployedWorkflowState : currentWorkflowState

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            {showingDeployed ? 'Deployed Workflow' : 'Current Workflow'}
          </h3>
          {/* Controls */}
          <div className="flex items-center gap-4">
            {/* Version toggle - only show if there's a current version */}
            {currentWorkflowState && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowingDeployed(!showingDeployed)}
              >
                {showingDeployed ? 'Show Current' : 'Show Deployed'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Workflow preview with fixed height */}
        <div className="h-[500px] w-full">
          {workflowToShow ? (
            <WorkflowPreview
              workflowState={workflowToShow}
              showSubBlocks={true}
              height="100%"
              width="100%"
              isPannable={true}
              defaultPosition={{ x: 0, y: 0 }}
              defaultZoom={1}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No workflow data available
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
