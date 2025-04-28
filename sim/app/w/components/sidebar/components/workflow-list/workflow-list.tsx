'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { ScrollText } from 'lucide-react'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowListProps {
  regularWorkflows: WorkflowMetadata[]
  marketplaceWorkflows: WorkflowMetadata[]
  isCollapsed?: boolean
}

export function WorkflowList({
  regularWorkflows,
  marketplaceWorkflows,
  isCollapsed,
}: WorkflowListProps) {
  const pathname = usePathname()

  // Calculate if we need scrolling (more than 16 total workflows)
  const totalWorkflows = regularWorkflows.length + marketplaceWorkflows.length
  const needsScrolling = totalWorkflows > 16

  if (isCollapsed) {
    // Collapsed view
    return (
      <div
        className={clsx(
          'space-y-[1px]',
          needsScrolling && 'max-h-[calc(100vh-350px)] overflow-y-auto scrollbar-thin'
        )}
      >
        {regularWorkflows.map((workflow) => (
          <Link
            key={workflow.id}
            href={`/w/${workflow.id}`}
            className={clsx(
              'flex items-center justify-center rounded-md text-sm font-medium text-muted-foreground w-8 h-8 mx-auto',
              pathname === `/w/${workflow.id}` ? 'bg-accent' : 'hover:bg-accent/50'
            )}
          >
            <div
              className="h-[14px] w-[14px] rounded flex-shrink-0"
              style={{ backgroundColor: workflow.color }}
            />
          </Link>
        ))}

        {marketplaceWorkflows.length > 0 && (
          <div className="mt-2 pt-2 border-t">
            {marketplaceWorkflows.map((workflow) => (
              <Link
                key={workflow.id}
                href={`/w/${workflow.id}`}
                className={clsx(
                  'flex items-center justify-center rounded-md text-sm font-medium text-muted-foreground w-8 h-8 mx-auto',
                  pathname === `/w/${workflow.id}` ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <div
                  className="h-[14px] w-[14px] rounded flex-shrink-0"
                  style={{ backgroundColor: workflow.color }}
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Expanded view
  return (
    <div
      className={clsx(
        'space-y-[1px]',
        needsScrolling && 'max-h-[calc(100vh-350px)] overflow-y-auto scrollbar-thin'
      )}
    >
      {regularWorkflows.map((workflow) => (
        <WorkflowItem
          key={workflow.id}
          workflow={workflow}
          active={pathname === `/w/${workflow.id}`}
          isCollapsed={isCollapsed}
        />
      ))}

      {marketplaceWorkflows.length > 0 && (
        <div className="mt-2 pt-2 border-t">
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
    </div>
  )
}

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
      className={clsx('flex items-center rounded-md text-sm font-medium text-muted-foreground', {
        'bg-accent': active,
        'hover:bg-accent/50': !active,
        'w-full px-2 py-[6px] gap-2': !isCollapsed,
        'w-8 h-8 mx-auto justify-center': isCollapsed,
      })}
    >
      <div
        className={clsx('shrink-0 rounded', {
          'h-[12px] w-[12px]': !isCollapsed,
          'h-[14px] w-[14px]': isCollapsed,
        })}
        style={{ backgroundColor: workflow.color }}
      />
      {!isCollapsed && (
        <span className="truncate">
          {workflow.name || (isMarketplace ? '[Marketplace Workflow]' : '[Untitled]')}
        </span>
      )}
    </Link>
  )
}
