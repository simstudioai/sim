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
  currentWorkflowState?: {
    blocks: Record<string, any>
    edges: Array<any>
    loops: Record<string, any>
  }
  deployedWorkflowState: {
    blocks: Record<string, any>
    edges: Array<any>
    loops: Record<string, any>
  }
  className?: string
}

export function DeployedWorkflowCard({
  currentWorkflowState,
  deployedWorkflowState,
  className,
}: DeployedWorkflowCardProps) {
  const [showingDeployed, setShowingDeployed] = useState(true)
  const workflowToShow = showingDeployed ? deployedWorkflowState : currentWorkflowState
  console.log('workflowToShow', workflowToShow)

  // Add detailed logging for debugging
  useEffect(() => {
    if (workflowToShow) {
      // Log basic stats
      const blockCount = Object.keys(workflowToShow.blocks || {}).length;
      const blocksWithSubBlocks = Object.values(workflowToShow.blocks || {})
        .filter(block => block.subBlocks && Object.keys(block.subBlocks).length > 0);
      
      logger.info(`[WORKFLOW-STATE] ${showingDeployed ? 'Deployed' : 'Current'} workflow with ${blockCount} blocks`, {
        type: showingDeployed ? 'deployed' : 'current',
        blockCount,
        blocksWithSubBlocksCount: blocksWithSubBlocks.length,
        // Log a sample of a block with subblocks if any exist
        sampleBlock: blocksWithSubBlocks.length > 0 
          ? {
              id: blocksWithSubBlocks[0].id,
              type: blocksWithSubBlocks[0].type,
              subBlocksCount: Object.keys(blocksWithSubBlocks[0].subBlocks || {}).length,
              subBlocksSample: Object.entries(blocksWithSubBlocks[0].subBlocks || {}).slice(0, 2)
            }
          : null
      });
      
      // For deep debug, log each block's subblocks (limited data for readability)
      Object.entries(workflowToShow.blocks || {}).forEach(([blockId, block]) => {
        if (block.subBlocks && Object.keys(block.subBlocks).length > 0) {
          logger.info(`[BLOCK-SUBBLOCKS] ${showingDeployed ? 'Deployed' : 'Current'} block ${blockId}`, {
            blockId,
            blockType: block.type,
            subBlocksCount: Object.keys(block.subBlocks).length,
            // Just log IDs to avoid huge logs, but include a couple of values as examples
            subBlockIds: Object.keys(block.subBlocks),
            sampleValues: Object.entries(block.subBlocks).slice(0, 2).map(([id, value]) => ({ id, value }))
          });
        }
      });
    }
  }, [workflowToShow, showingDeployed]);
  
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

  {console.log('sanitizedWorkflowState', sanitizedWorkflowState)}

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader
        className={cn(
          'sticky top-0 z-10 space-y-4 p-4',
          'backdrop-blur-xl',
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

      <CardContent className='p-0'>
        {/* Workflow preview with fixed height */}
        <div className="h-[500px] w-full">
          {sanitizedWorkflowState ? (
            <WorkflowPreview
              key={previewKey}
              workflowState={sanitizedWorkflowState}
              showSubBlocks={true}
              height='100%'
              width='100%'
              isPannable={true}
              defaultPosition={{ x: 0, y: 0 }}
              defaultZoom={1}
            />
          ) : (
            <div className='flex h-full items-center justify-center text-muted-foreground'>
              No workflow data available
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
