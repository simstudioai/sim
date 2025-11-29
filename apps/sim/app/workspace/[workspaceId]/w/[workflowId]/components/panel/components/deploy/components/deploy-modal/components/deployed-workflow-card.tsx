'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('DeployedWorkflowCard')

interface DeployedWorkflowCardProps {
  currentWorkflowState?: WorkflowState
  activeDeployedWorkflowState?: WorkflowState
  selectedDeployedWorkflowState?: WorkflowState
  selectedVersionLabel?: string
  className?: string
}

export function DeployedWorkflowCard({
  currentWorkflowState,
  activeDeployedWorkflowState,
  selectedDeployedWorkflowState,
  selectedVersionLabel,
  className,
}: DeployedWorkflowCardProps) {
  type View = 'current' | 'active' | 'selected'
  const hasCurrent = !!currentWorkflowState
  const hasActive = !!activeDeployedWorkflowState
  const hasSelected = !!selectedDeployedWorkflowState

  const [view, setView] = useState<View>(hasSelected ? 'selected' : 'active')
  const workflowToShow =
    view === 'current'
      ? currentWorkflowState
      : view === 'active'
        ? activeDeployedWorkflowState
        : selectedDeployedWorkflowState
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const previewKey = useMemo(() => {
    return `${view}-preview-${activeWorkflowId}`
  }, [view, activeWorkflowId])

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
          <h3 className='font-medium'>Workflow Preview</h3>
          <div className='flex items-center gap-2'>
            {/* Show Current only when no explicit version is selected */}
            {hasCurrent && !hasSelected && (
              <button
                type='button'
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  view === 'current' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                )}
                onClick={() => setView('current')}
              >
                Current
              </button>
            )}
            {/* Always show Active Deployed */}
            {hasActive && (
              <button
                type='button'
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  view === 'active' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                )}
                onClick={() => setView('active')}
              >
                Active Deployed
              </button>
            )}
            {/* If a specific version is selected, show its label */}
            {hasSelected && (
              <button
                type='button'
                className={cn(
                  'rounded px-2 py-1 text-xs',
                  view === 'selected' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                )}
                onClick={() => setView('selected')}
              >
                {selectedVersionLabel || 'Selected Version'}
              </button>
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
            defaultZoom={0.8}
          />
        </div>
      </CardContent>
    </Card>
  )
}
