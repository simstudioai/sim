'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logs/console-logger'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/workflow-preview'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployedWorkflowCard')

interface DeployedWorkflowCardProps {
  currentWorkflowState?: WorkflowState
  deployedWorkflowState: WorkflowState
  className?: string
}

export function DeployedWorkflowCard({
  currentWorkflowState,
  deployedWorkflowState,
  className,
}: DeployedWorkflowCardProps) {
  const [showingDeployed, setShowingDeployed] = useState(true)
  const workflowToShow = showingDeployed ? deployedWorkflowState : currentWorkflowState
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  
  // Create sanitized workflow state
  // const sanitizedWorkflowState = useMemo(() => {
  //   if (!workflowToShow) return null;
    
  //   // Verify the workflow ID matches if metadata exists
  //   if (workflowToShow._metadata?.workflowId && 
  //       workflowToShow._metadata.workflowId !== activeWorkflowId) {
  //     logger.warn('Workflow ID mismatch detected in card', {
  //       stateWorkflowId: workflowToShow._metadata.workflowId,
  //       activeWorkflowId,
  //       isDeployed: showingDeployed
  //     });
  //   }
    
  //   // Filter out invalid blocks and make deep clone to avoid reference issues
  //   const result = {
  //     blocks: Object.fromEntries(
  //       Object.entries(workflowToShow.blocks || {})
  //         .filter(([_, block]) => block && block.type) // Filter out invalid blocks
  //         .map(([id, block]) => {
  //           // Deep clone the block to avoid any reference sharing
  //           const clonedBlock = structuredClone(block);
  //           return [id, clonedBlock];
  //         })
  //     ),
  //     edges: workflowToShow.edges ? structuredClone(workflowToShow.edges) : [],
  //     loops: workflowToShow.loops ? structuredClone(workflowToShow.loops) : {},
  //     _metadata: {
  //       ...(workflowToShow._metadata || {}),
  //       workflowId: activeWorkflowId,
  //       viewType: showingDeployed ? 'deployed' : 'current',
  //       sanitizedAt: Date.now()
  //     }
  //   };
    
  //   return result;
  // }, [workflowToShow, showingDeployed, activeWorkflowId]);

  // // Generate a unique key for the workflow preview
  const previewKey = useMemo(() => {
    return `${showingDeployed ? 'deployed' : 'current'}-preview-${activeWorkflowId}}`;
  }, [showingDeployed, activeWorkflowId]);

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader
        className={cn(
          'space-y-4 p-4 sticky top-0 z-10',
          'bg-background/70 dark:bg-background/50',
          'border-border/30 border-b dark:border-border/20',
          'shadow-sm'
        )}
      >
        <div className='flex items-center justify-between'>
          <h3 className='font-medium'>
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
      
      <div className="h-px w-full bg-border shadow-sm"></div>

      <CardContent className="p-0"> 
        {/* Workflow preview with fixed height */}
        <div className="h-[500px] w-full">
          {/* {sanitizedWorkflowState ? ( */}
            <WorkflowPreview
              key={previewKey}
              workflowState={workflowToShow as WorkflowState}
              showSubBlocks={true}
              height='100%'
              width='100%'
              isPannable={true}
              defaultPosition={{ x: 0, y: 0 }}
              defaultZoom={1}
            />
        </div>
      </CardContent>
    </Card>
  )
}
