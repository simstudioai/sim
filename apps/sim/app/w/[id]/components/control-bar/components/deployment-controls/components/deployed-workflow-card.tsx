'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/workflow-preview'

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
          <div className='flex items-center gap-4'>
            {/* Version toggle - only show if there's a current version */}
            {currentWorkflowState && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => setShowingDeployed(!showingDeployed)}
              >
                {showingDeployed ? 'Show Current' : 'Show Deployed'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className='p-0'>
        {/* Workflow preview with fixed height */}
        <div className='h-[500px] w-full'>
          {workflowToShow ? (
            <WorkflowPreview
              key={showingDeployed ? 'deployed-preview' : 'current-preview'} 
              workflowState={workflowToShow}
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
