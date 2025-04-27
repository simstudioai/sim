'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { ScrollText } from 'lucide-react'
import { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface WorkflowListProps {
  regularWorkflows: WorkflowMetadata[]
  marketplaceWorkflows: WorkflowMetadata[]
}

export function WorkflowList({ regularWorkflows, marketplaceWorkflows }: WorkflowListProps) {
  const pathname = usePathname()

  return (
    <div className="space-y-1">
      {regularWorkflows.map((workflow) => (
        <WorkflowItem
          key={workflow.id}
          workflow={workflow}
          active={pathname === `/w/${workflow.id}`}
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
}

function WorkflowItem({ workflow, active, isMarketplace }: WorkflowItemProps) {
  // Generate a deterministic color based on workflow id
  const getWorkflowColor = (id: string) => {
    const colors = [
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-red-500',
      'bg-orange-500',
    ]

    // Simple hash function to get a stable index
    const hash = id.split('').reduce((acc, char) => {
      return char.charCodeAt(0) + ((acc << 5) - acc)
    }, 0)

    const index = Math.abs(hash) % colors.length
    return colors[index]
  }

  return (
    <Link
      href={`/w/${workflow.id}`}
      className={clsx(
        'flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground',
        {
          'bg-accent': active,
          'hover:bg-accent/50': !active,
        }
      )}
    >
      <div className={clsx('h-3 w-3 shrink-0 rounded', getWorkflowColor(workflow.id))} />
      <span className="truncate">
        {workflow.name || (isMarketplace ? '[Marketplace Workflow]' : '[Untitled]')}
      </span>
    </Link>
  )
}
