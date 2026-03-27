import type { MouseEvent as ReactMouseEvent } from 'react'
import { Folder, MoreHorizontal, Plus } from 'lucide-react'
import Link from 'next/link'
import {
  Blimp,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { ConversationListItem } from '@/app/workspace/[workspaceId]/components'
import type { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface CollapsedSidebarMenuProps {
  icon: React.ReactNode
  hover: ReturnType<typeof useHoverMenu>
  ariaLabel?: string
  children: React.ReactNode
  className?: string
  primaryAction?: {
    label: string
    onSelect: () => void
  }
}

interface CollapsedTaskFlyoutItemProps {
  task: { id: string; href: string; name: string; isActive?: boolean; isUnread?: boolean }
  isCurrentRoute: boolean
  isEditing?: boolean
  editValue?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  isRenaming?: boolean
  onEditValueChange?: (value: string) => void
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditBlur?: () => void
  onContextMenu?: (e: ReactMouseEvent, taskId: string) => void
  onMorePointerDown?: () => void
  onMoreClick?: (e: ReactMouseEvent<HTMLButtonElement>, taskId: string) => void
}

interface CollapsedWorkflowFlyoutItemProps {
  workflow: WorkflowMetadata
  href: string
  isCurrentRoute?: boolean
  isEditing?: boolean
  editValue?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  isRenaming?: boolean
  onEditValueChange?: (value: string) => void
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditBlur?: () => void
  onContextMenu?: (e: ReactMouseEvent, workflow: WorkflowMetadata) => void
  onMorePointerDown?: () => void
  onMoreClick?: (e: ReactMouseEvent<HTMLButtonElement>, workflow: WorkflowMetadata) => void
}

const EDIT_ROW_CLASS =
  'mx-0.5 flex min-h-[30px] min-w-0 cursor-default select-none items-center gap-2 rounded-[5px] bg-[var(--surface-active)] px-2 py-1.5 font-medium text-[12px] text-[var(--text-body)]'

function FlyoutMoreButton({
  ariaLabel,
  onPointerDown,
  onClick,
}: {
  ariaLabel: string
  onPointerDown?: () => void
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type='button'
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className='-translate-y-1/2 absolute top-1/2 right-[8px] z-10 flex h-[18px] w-[18px] items-center justify-center rounded-[4px] opacity-0 transition-opacity hover:bg-[var(--surface-7)] focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100'
    >
      <MoreHorizontal className='h-[16px] w-[16px] text-[var(--text-icon)]' />
    </button>
  )
}

function TaskStatusIcon({
  isActive,
  isUnread,
  hideStatusOnHover = false,
}: {
  isActive?: boolean
  isUnread?: boolean
  hideStatusOnHover?: boolean
}) {
  return (
    <span className='relative flex-shrink-0'>
      <Blimp className='h-[16px] w-[16px] text-[var(--text-icon)]' />
      {isActive && (
        <span
          className={cn(
            '-right-[1px] -bottom-[1px] absolute h-[6px] w-[6px] rounded-full border border-[var(--surface-1)] bg-amber-400',
            hideStatusOnHover && 'group-hover:hidden'
          )}
        />
      )}
      {!isActive && isUnread && (
        <span
          className={cn(
            '-right-[1px] -bottom-[1px] absolute h-[6px] w-[6px] rounded-full border border-[var(--surface-1)] bg-[var(--indicator-online)]',
            hideStatusOnHover && 'group-hover:hidden'
          )}
        />
      )}
    </span>
  )
}

function WorkflowColorSwatch({ color }: { color: string }) {
  return (
    <div
      className='h-[14px] w-[14px] flex-shrink-0 rounded-[3px] border-[2px]'
      style={{
        backgroundColor: color,
        borderColor: `${color}60`,
        backgroundClip: 'padding-box',
      }}
    />
  )
}

export function CollapsedSidebarMenu({
  icon,
  hover,
  ariaLabel,
  children,
  className,
  primaryAction,
}: CollapsedSidebarMenuProps) {
  return (
    <div className={cn('flex flex-col px-2', className)}>
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
              className='mx-0.5 flex h-[30px] items-center rounded-[8px] px-2 hover:bg-[var(--surface-active)]'
            >
              {icon}
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent side='right' align='start' sideOffset={8} {...hover.contentProps}>
          {primaryAction && (
            <>
              <DropdownMenuItem onSelect={primaryAction.onSelect}>
                <Plus className='h-[14px] w-[14px]' />
                {primaryAction.label}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function CollapsedTaskFlyoutItem({
  task,
  isCurrentRoute,
  isEditing = false,
  editValue,
  inputRef,
  isRenaming = false,
  onEditValueChange,
  onEditKeyDown,
  onEditBlur,
  onContextMenu,
  onMorePointerDown,
  onMoreClick,
}: CollapsedTaskFlyoutItemProps) {
  const showActions = task.id !== 'new' && onMoreClick

  if (isEditing) {
    return (
      <div className={EDIT_ROW_CLASS}>
        <TaskStatusIcon isActive={task.isActive} isUnread={task.isUnread} />
        <input
          aria-label={`Rename task ${task.name}`}
          ref={inputRef}
          value={editValue ?? task.name}
          onChange={(e) => onEditValueChange?.(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className='w-full min-w-0 border-0 bg-transparent p-0 font-medium text-[12px] text-[var(--text-body)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
          maxLength={100}
          disabled={isRenaming}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
        />
      </div>
    )
  }

  return (
    <div className='group relative mx-0.5'>
      <Link
        href={task.href}
        className={cn(
          'flex min-h-[30px] min-w-0 items-center rounded-[5px] px-2 py-[5px] pr-[30px] font-medium text-[12px] text-[var(--text-body)] hover:bg-[var(--surface-active)] group-focus-within:bg-[var(--surface-active)] group-hover:bg-[var(--surface-active)]',
          isCurrentRoute && 'bg-[var(--surface-active)]'
        )}
        onContextMenu={
          task.id !== 'new' && onContextMenu ? (e) => onContextMenu(e, task.id) : undefined
        }
      >
        <ConversationListItem
          title={task.name}
          isActive={!!task.isActive}
          isUnread={!!task.isUnread}
          statusIndicatorClassName={!isCurrentRoute ? 'group-hover:hidden' : undefined}
        />
      </Link>
      {showActions && (
        <FlyoutMoreButton
          ariaLabel='Task options'
          onPointerDown={onMorePointerDown}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMoreClick?.(e, task.id)
          }}
        />
      )}
    </div>
  )
}

export function CollapsedWorkflowFlyoutItem({
  workflow,
  href,
  isCurrentRoute = false,
  isEditing = false,
  editValue,
  inputRef,
  isRenaming = false,
  onEditValueChange,
  onEditKeyDown,
  onEditBlur,
  onContextMenu,
  onMorePointerDown,
  onMoreClick,
}: CollapsedWorkflowFlyoutItemProps) {
  const showActions = !!onMoreClick

  if (isEditing) {
    return (
      <div className={EDIT_ROW_CLASS}>
        <WorkflowColorSwatch color={workflow.color} />
        <input
          aria-label={`Rename workflow ${workflow.name}`}
          ref={inputRef}
          value={editValue ?? workflow.name}
          onChange={(e) => onEditValueChange?.(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className='w-full min-w-0 border-0 bg-transparent p-0 font-medium text-[12px] text-[var(--text-body)] outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
          maxLength={100}
          disabled={isRenaming}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
        />
      </div>
    )
  }

  return (
    <div className='group relative mx-0.5'>
      <Link
        href={href}
        className={cn(
          'flex min-h-[30px] min-w-0 items-center gap-2 rounded-[5px] px-2 py-[5px] pr-[30px] font-medium text-[12px] text-[var(--text-body)] hover:bg-[var(--surface-active)] group-focus-within:bg-[var(--surface-active)] group-hover:bg-[var(--surface-active)]',
          isCurrentRoute && 'bg-[var(--surface-active)]'
        )}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, workflow) : undefined}
      >
        <WorkflowColorSwatch color={workflow.color} />
        <span className='min-w-0 flex-1 truncate'>{workflow.name}</span>
      </Link>
      {showActions && (
        <FlyoutMoreButton
          ariaLabel='Workflow options'
          onPointerDown={onMorePointerDown}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onMoreClick?.(e, workflow)
          }}
        />
      )}
    </div>
  )
}

export function CollapsedFolderItems({
  nodes,
  workflowsByFolder,
  workspaceId,
  currentWorkflowId,
  editingWorkflowId,
  editingValue,
  editInputRef,
  isRenamingWorkflow,
  onEditValueChange,
  onEditKeyDown,
  onEditBlur,
  onWorkflowContextMenu,
  onWorkflowMorePointerDown,
  onWorkflowMoreClick,
}: {
  nodes: FolderTreeNode[]
  workflowsByFolder: Record<string, WorkflowMetadata[]>
  workspaceId: string
  currentWorkflowId?: string
  editingWorkflowId?: string | null
  editingValue?: string
  editInputRef?: React.RefObject<HTMLInputElement | null>
  isRenamingWorkflow?: boolean
  onEditValueChange?: (value: string) => void
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditBlur?: () => void
  onWorkflowContextMenu?: (e: ReactMouseEvent, workflow: WorkflowMetadata) => void
  onWorkflowMorePointerDown?: () => void
  onWorkflowMoreClick?: (e: ReactMouseEvent<HTMLButtonElement>, workflow: WorkflowMetadata) => void
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
                currentWorkflowId={currentWorkflowId}
                editingWorkflowId={editingWorkflowId}
                editingValue={editingValue}
                editInputRef={editInputRef}
                isRenamingWorkflow={isRenamingWorkflow}
                onEditValueChange={onEditValueChange}
                onEditKeyDown={onEditKeyDown}
                onEditBlur={onEditBlur}
                onWorkflowContextMenu={onWorkflowContextMenu}
                onWorkflowMorePointerDown={onWorkflowMorePointerDown}
                onWorkflowMoreClick={onWorkflowMoreClick}
              />
              {folderWorkflows.map((workflow) => (
                <CollapsedWorkflowFlyoutItem
                  key={workflow.id}
                  workflow={workflow}
                  href={`/workspace/${workspaceId}/w/${workflow.id}`}
                  isCurrentRoute={workflow.id === currentWorkflowId}
                  isEditing={workflow.id === editingWorkflowId}
                  editValue={editingValue}
                  inputRef={editInputRef}
                  isRenaming={isRenamingWorkflow}
                  onEditValueChange={onEditValueChange}
                  onEditKeyDown={onEditKeyDown}
                  onEditBlur={onEditBlur}
                  onContextMenu={onWorkflowContextMenu}
                  onMorePointerDown={onWorkflowMorePointerDown}
                  onMoreClick={onWorkflowMoreClick}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}
