'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { ScrollText } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowItemProps {
  workflow: WorkflowMetadata
  active: boolean
  isMarketplace?: boolean
  isCollapsed?: boolean
}

function WorkflowItem({ workflow, active, isMarketplace, isCollapsed }: WorkflowItemProps) {
  return (
    <Link
      href={`/w/${workflow.id}`}
      className={clsx(
        'flex items-center rounded-md px-2 py-1.5 text-sm font-medium',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
        isCollapsed && 'justify-center w-8 h-8 mx-auto'
      )}
    >
      <div
        className={clsx(
          'flex-shrink-0 rounded',
          isCollapsed ? 'h-[14px] w-[14px]' : 'h-[14px] w-[14px] mr-2'
        )}
        style={{ backgroundColor: workflow.color }}
      />
      {!isCollapsed && (
        <span className="truncate">
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
  const { activeWorkspaceId } = useWorkflowRegistry()
  const { data: session } = useSession()

  // Generate skeleton items for loading state
  const skeletonItems = useMemo(() => {
    return Array(4)
      .fill(0)
      .map((_, i) => (
        <div
          key={`skeleton-${i}`}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md mb-1 ${
            isCollapsed ? 'justify-center' : ''
          }`}
        >
          {isCollapsed ? (
            <Skeleton className="h-[14px] w-[14px] rounded-md" />
          ) : (
            <>
              <Skeleton className="h-[14px] w-[14px] rounded-md" />
              <Skeleton className="h-4 w-20" />
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
              active={pathname === `/w/${workflow.id}`}
              isCollapsed={isCollapsed}
            />
          ))}

          {/* Marketplace Temp Workflows (if any) */}
          {marketplaceWorkflows.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <h3
                className={`mb-1 px-2 text-xs font-medium text-muted-foreground ${
                  isCollapsed ? 'text-center' : ''
                }`}
              >
                {isCollapsed ? '' : 'Marketplace'}
              </h3>
              {marketplaceWorkflows.map((workflow) => (
                <WorkflowItem
                  key={workflow.id}
                  workflow={workflow}
                  active={pathname === `/w/${workflow.id}`}
                  isMarketplace
                  isCollapsed={isCollapsed}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {showEmptyState && !isCollapsed && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No workflows in {activeWorkspaceId ? 'this workspace' : 'your account'}. Create one to
              get started.
            </div>
          )}
        </>
      )}
    </div>
  )
}
