import { Folder } from 'lucide-react'
import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface CollapsedSidebarMenuProps {
  icon: React.ReactNode
  hover: ReturnType<typeof useHoverMenu>
  onClick?: () => void
  ariaLabel?: string
  children: React.ReactNode
  className?: string
}

export function CollapsedSidebarMenu({
  icon,
  hover,
  onClick,
  ariaLabel,
  children,
  className,
}: CollapsedSidebarMenuProps) {
  return (
    <div className={cn('flex flex-col px-[8px]', className)}>
      <DropdownMenu
        open={hover.isOpen}
        onOpenChange={(open) => {
          if (open) hover.open()
          else hover.close()
        }}
        modal={false}
      >
        <div {...hover.triggerProps}>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              aria-label={ariaLabel}
              className='mx-[2px] flex h-[30px] items-center rounded-[8px] px-[8px] hover:bg-[var(--surface-active)]'
              onClick={onClick}
            >
              {icon}
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent side='right' align='start' sideOffset={8} {...hover.contentProps}>
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function CollapsedFolderItems({
  nodes,
  workflowsByFolder,
  workspaceId,
}: {
  nodes: FolderTreeNode[]
  workflowsByFolder: Record<string, WorkflowMetadata[]>
  workspaceId: string
}) {
  return (
    <>
      {nodes.map((folder) => {
        const folderWorkflows = workflowsByFolder[folder.id] || []
        const hasChildren = folder.children.length > 0 || folderWorkflows.length > 0

        if (!hasChildren) {
          return (
            <DropdownMenuItem key={folder.id} disabled>
              <Folder className='h-[14px] w-[14px]' />
              <span className='truncate'>{folder.name}</span>
            </DropdownMenuItem>
          )
        }

        return (
          <DropdownMenuSub key={folder.id}>
            <DropdownMenuSubTrigger>
              <Folder className='h-[14px] w-[14px]' />
              <span className='truncate'>{folder.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <CollapsedFolderItems
                nodes={folder.children}
                workflowsByFolder={workflowsByFolder}
                workspaceId={workspaceId}
              />
              {folderWorkflows.map((workflow) => (
                <DropdownMenuItem key={workflow.id} asChild>
                  <Link href={`/workspace/${workspaceId}/w/${workflow.id}`}>
                    <div
                      className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
                      style={{
                        backgroundColor: workflow.color,
                        borderColor: `${workflow.color}60`,
                        backgroundClip: 'padding-box',
                      }}
                    />
                    <span className='truncate'>{workflow.name}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}
