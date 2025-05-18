'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logs/console-logger'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/workflow-preview'

const logger = createLogger('DeployedWorkflowCard')

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
  
  // Create sanitized workflow state
  const sanitizedWorkflowState = useMemo(() => {
    if (!workflowToShow) return null;
    
    // Filter out invalid blocks and make deep clone to avoid reference issues
    return {
      blocks: Object.fromEntries(
        Object.entries(workflowToShow.blocks || {})
          .filter(([_, block]) => block && block.type) // Filter out invalid blocks
          .map(([id, block]) => {
            // Deep clone the block to avoid any reference sharing
            const clonedBlock = JSON.parse(JSON.stringify(block));
            return [id, clonedBlock];
          })
      ),
      edges: workflowToShow.edges ? JSON.parse(JSON.stringify(workflowToShow.edges)) : [],
      loops: workflowToShow.loops ? JSON.parse(JSON.stringify(workflowToShow.loops)) : {}
    };
  }, [workflowToShow]);

  // Generate a unique key for the workflow preview
  const previewKey = useMemo(() => {
    return `${showingDeployed ? 'deployed' : 'current'}-preview-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }, [showingDeployed]);

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            {showingDeployed ? 'Deployed Workflow' : 'Current Workflow'}
          </h3>
          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Version toggle - only show if there's a current version */}
            {currentWorkflowState && (
              <div className="flex items-center space-x-2">
                <Label htmlFor="workflow-version-toggle" className="text-sm text-muted-foreground">
                  Current
                </Label>
                <Switch 
                  id="workflow-version-toggle"
                  checked={showingDeployed} 
                  onCheckedChange={setShowingDeployed}
                />
                <Label htmlFor="workflow-version-toggle" className="text-sm text-muted-foreground">
                  Deployed
                </Label>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Workflow preview with fixed height */}
        <div className="h-[500px] w-full">
          {sanitizedWorkflowState ? (
            <WorkflowPreview
              key={previewKey}
              workflowState={sanitizedWorkflowState}
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
