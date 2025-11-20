'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  isMarketplace?: boolean
}

function WorkflowItem({ workflow, active, isMarketplace }: WorkflowItemProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  return (
    <Link
      href={`/workspace/${workspaceId}/w/${workflow.id}`}
      className={clsx(
        'flex items-center rounded-md px-2 py-1.5 font-medium text-sm',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
      )}
    >
      <div
        className='mr-2 h-[14px] w-[14px] flex-shrink-0 rounded'
        style={{ backgroundColor: workflow.color }}
      />
      <span className='truncate'>
        {workflow.name}
        {isMarketplace && ' (Preview)'}
      </span>
    </Link>
  )
}

interface WorkflowListProps {
  regularWorkflows: WorkflowMetadata[]
  isLoading?: boolean
}

export function WorkflowList({ regularWorkflows, isLoading = false }: WorkflowListProps) {
  const pathname = usePathname()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { data: session } = useSession()

  // Generate skeleton items for loading state
  const skeletonItems = useMemo(() => {
    return Array(4)
      .fill(0)
      .map((_, i) => (
        <div
          key={`skeleton-${i}`}
          className='mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5'
        >
          <Skeleton className='h-[14px] w-[14px] rounded-md' />
          <Skeleton className='h-4 w-20' />
        </div>
      ))
  }, [])

  // Only show empty state when not loading and user is logged in
  const showEmptyState = !isLoading && session?.user && regularWorkflows.length === 0

  return (
    <div className={`space-y-1 ${isLoading ? 'opacity-60' : ''}`}>
      {isLoading ? (
        // Show skeleton loading state
        skeletonItems
      ) : (
        <>
          {/* Regular workflows */}
          {regularWorkflows.map((workflow) => (
            <WorkflowItem
              key={workflow.id}
              workflow={workflow}
              active={pathname === `/workspace/${workspaceId}/w/${workflow.id}`}
            />
          ))}
        </>
      )}
    </div>
  )
}
