'use client'

import type { Workflow } from '../../types'
import { TemplateWorkflowCard } from '../template-workflow-card'
import { WorkflowCardSkeleton } from '../workflow-card-skeleton'

interface TemplateGridProps {
  workflows?: Workflow[]
  isLoading?: boolean
  skeletonCount?: number
  emptyMessage?: string
  onTemplateMount?: (element: HTMLElement, templateId: string) => void
}

export function TemplateGrid({
  workflows = [],
  isLoading = false,
  skeletonCount = 6,
  emptyMessage = 'No templates available',
  onTemplateMount,
}: TemplateGridProps) {
  if (isLoading) {
    return (
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
        {Array.from({ length: skeletonCount }).map((_, index) => (
          <WorkflowCardSkeleton key={`skeleton-${index}`} />
        ))}
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <div className='flex h-32 items-center justify-center text-muted-foreground text-sm'>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
      {workflows.map((workflow, index) => (
        <TemplateWorkflowCard
          key={workflow.id}
          workflow={workflow}
          index={index}
          onMount={onTemplateMount}
        />
      ))}
    </div>
  )
}
