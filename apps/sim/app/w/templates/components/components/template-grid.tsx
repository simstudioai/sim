'use client'

import type { ReactNode } from 'react'
import type { Workflow } from '../../types'
import { TemplateWorkflowCard } from '../template-workflow-card'
import { WorkflowCardSkeleton } from '../workflow-card-skeleton'

// Reusable grid layout component
interface GridLayoutProps {
  children: ReactNode
  columns?: {
    sm?: number
    md?: number
    lg?: number
  }
  className?: string
}

function GridLayout({ children, columns = { md: 2, lg: 3 }, className = '' }: GridLayoutProps) {
  const gridClasses = [
    'grid',
    'grid-cols-1',
    'gap-6',
    columns.md ? `md:grid-cols-${columns.md}` : 'md:grid-cols-2',
    columns.lg ? `lg:grid-cols-${columns.lg}` : 'lg:grid-cols-3',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return <div className={gridClasses}>{children}</div>
}

interface TemplateGridProps {
  workflows: Workflow[]
  isLoading?: boolean
  emptyMessage?: string
  skeletonCount?: number
  onRegisterCard?: (element: HTMLElement, templateId: string) => void
  columns?: {
    sm?: number
    md?: number
    lg?: number
  }
}

export function TemplateGrid({
  workflows,
  isLoading = false,
  emptyMessage = 'No templates found',
  skeletonCount = 6,
  onRegisterCard,
  columns,
}: TemplateGridProps) {
  if (isLoading) {
    return (
      <GridLayout columns={columns}>
        {Array.from({ length: skeletonCount }).map((_, index) => (
          <WorkflowCardSkeleton key={`skeleton-${index}`} />
        ))}
      </GridLayout>
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
    <GridLayout columns={columns}>
      {workflows.map((workflow, index) => (
        <TemplateWorkflowCard
          key={workflow.id}
          workflow={workflow}
          index={index}
          onMount={onRegisterCard}
        />
      ))}
    </GridLayout>
  )
}
