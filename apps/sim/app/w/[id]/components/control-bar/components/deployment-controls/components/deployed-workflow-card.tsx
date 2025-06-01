'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/w/components/workflow-preview/workflow-preview'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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

  const previewKey = useMemo(() => {
    return `${showingDeployed ? 'deployed' : 'current'}-preview-${activeWorkflowId}}`
  }, [showingDeployed, activeWorkflowId])

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader
        className={cn(
          'sticky top-0 z-10 space-y-4 p-4',
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
          <div className='flex items-center gap-2'>
            {/* Version toggle - only show if there's a current version */}
            {currentWorkflowState && (
              <div className='flex items-center space-x-2'>
                <Label htmlFor='workflow-version-toggle' className='text-muted-foreground text-sm'>
                  Current
                </Label>
                <Switch
                  id='workflow-version-toggle'
                  checked={showingDeployed}
                  onCheckedChange={setShowingDeployed}
                />
                <Label htmlFor='workflow-version-toggle' className='text-muted-foreground text-sm'>
                  Deployed
                </Label>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <div className='h-px w-full bg-border shadow-sm' />

      <CardContent className='p-0'>
        {/* Workflow preview with fixed height */}
        <div className='h-[500px] w-full'>
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
