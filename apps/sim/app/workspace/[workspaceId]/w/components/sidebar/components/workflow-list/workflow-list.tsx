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
  isCollapsed?: boolean
}

function WorkflowItem({ workflow, active, isMarketplace, isCollapsed }: WorkflowItemProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  return (
    <Link
      href={`/workspace/${workspaceId}/w/${workflow.id}`}
      className={clsx(
        'flex items-center rounded-md px-2 py-1.5 font-medium text-sm',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
        isCollapsed && 'mx-auto h-8 w-8 justify-center'
      )}
    >
      <div
        className={clsx(
          'flex-shrink-0 rounded',
          isCollapsed ? 'h-[14px] w-[14px]' : 'mr-2 h-[14px] w-[14px]'
        )}
        style={{ backgroundColor: workflow.color }}
      />
      {!isCollapsed && (
        <span className='truncate'>
          {workflow.name}
          {isMarketplace && ' (Preview)'}
        </span>
      )}
    </Link>
  )
}

interface WorkflowListProps {
  regularWorkflows: WorkflowMetadata[]
  marketplaceWorkflows: WorkflowMetadata[]
  isCollapsed?: boolean
  isLoading?: boolean
}

export function WorkflowList({
  regularWorkflows,
  marketplaceWorkflows,
  isCollapsed = false,
  isLoading = false,
}: WorkflowListProps) {
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
          className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 ${
            isCollapsed ? 'justify-center' : ''
          }`}
        >
          {isCollapsed ? (
            <Skeleton className='h-[14px] w-[14px] rounded-md' />
          ) : (
            <>
              <Skeleton className='h-[14px] w-[14px] rounded-md' />
              <Skeleton className='h-4 w-20' />
            </>
          )}
        </div>
      ))
  }, [isCollapsed])

  // Only show empty state when not loading and user is logged in
  const showEmptyState =
    !isLoading &&
    session?.user &&
    regularWorkflows.length === 0 &&
    marketplaceWorkflows.length === 0

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
              isCollapsed={isCollapsed}
            />
          ))}

          {/* Marketplace Temp Workflows (if any) */}
          {marketplaceWorkflows.length > 0 && (
            <div className='mt-2 border-border/30 border-t pt-2'>
              <h3
                className={`mb-1 px-2 font-medium text-muted-foreground text-xs ${
                  isCollapsed ? 'text-center' : ''
                }`}
              >
                {isCollapsed ? '' : 'Marketplace'}
              </h3>
              {marketplaceWorkflows.map((workflow) => (
                <WorkflowItem
                  key={workflow.id}
                  workflow={workflow}
                  active={pathname === `/workspace/${workspaceId}/w/${workflow.id}`}
                  isMarketplace
                  isCollapsed={isCollapsed}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {showEmptyState && !isCollapsed && (
            <div className='px-2 py-1.5 text-muted-foreground text-xs'>
              No workflows in {workspaceId ? 'this workspace' : 'your account'}. Create one to get
              started.
            </div>
          )}
        </>
      )}
    </div>
  )
}
