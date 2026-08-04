import { type MouseEvent as ReactMouseEvent, useState } from 'react'
import {
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemAction,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Pencil, SquareArrowUpRight } from '@sim/emcn/icons'
import { Folder, MoreHorizontal, Plus } from 'lucide-react'
import Link from 'next/link'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { ConversationListItem } from '@/app/workspace/[workspaceId]/components'
import type { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { interleaveSiblings } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import type { WorkspaceFileFolderApi } from '@/hooks/queries/workspace-file-folders'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

interface FileFolderFlyoutNode extends WorkspaceFileFolderApi {
  children: FileFolderFlyoutNode[]
  files: WorkspaceFileRecord[]
}

type FileFlyoutEntry =
  | { kind: 'folder'; id: string; name: string; folder: FileFolderFlyoutNode }
  | { kind: 'file'; id: string; name: string; file: WorkspaceFileRecord }

/**
 * Orders one level of the file flyout as a single list. Folders are not hoisted
 * above the files beside them — the Files page sorts folders and files together,
 * and a flyout that partitioned them would contradict the page it links into.
 */
function fileFlyoutEntries(
  folders: FileFolderFlyoutNode[],
  files: WorkspaceFileRecord[]
): FileFlyoutEntry[] {
  const entries: FileFlyoutEntry[] = [
    ...folders.map(
      (folder): FileFlyoutEntry => ({
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        folder,
      })
    ),
    ...files.map(
      (file): FileFlyoutEntry => ({
        kind: 'file',
        id: file.id,
        name: file.name,
        file,
      })
    ),
  ]
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

const FILE_FLYOUT_ICON = (
  <svg
    className='size-[14px] flex-shrink-0 text-[var(--text-icon)]'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
    <path d='M14 2v4a2 2 0 0 0 2 2h4' />
  </svg>
)

export function CollapsedFileFolderItems({
  nodes,
  rootFiles,
  workspaceId,
  currentFileId,
}: {
  nodes: FileFolderFlyoutNode[]
  rootFiles?: WorkspaceFileRecord[]
  workspaceId: string
  currentFileId?: string
}) {
  return (
    <>
      {fileFlyoutEntries(nodes, rootFiles ?? []).map((entry) => {
        if (entry.kind === 'file') {
          return (
            <DropdownMenuItem key={entry.id} asChild>
              <Link
                href={`/workspace/${workspaceId}/files/${entry.file.id}`}
                className={cn(currentFileId === entry.file.id && 'bg-[var(--surface-active)]')}
              >
                {FILE_FLYOUT_ICON}
                <span className='truncate'>{entry.name}</span>
              </Link>
            </DropdownMenuItem>
          )
        }

        const folder = entry.folder
        const hasChildren = folder.children.length > 0 || folder.files.length > 0

        if (!hasChildren) {
          return (
            <DropdownMenuItem key={folder.id} disabled>
              <Folder className='size-[14px]' />
              <span className='truncate'>{folder.name}</span>
            </DropdownMenuItem>
          )
        }

        return (
          <DropdownMenuSub key={folder.id}>
            <DropdownMenuSubTrigger className='focus:bg-[var(--surface-hover)] data-[state=open]:bg-[var(--surface-hover)]'>
              <Folder className='size-[14px]' />
              <span className='truncate'>{folder.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <CollapsedFileFolderItems
                nodes={folder.children}
                rootFiles={folder.files}
                workspaceId={workspaceId}
                currentFileId={currentFileId}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}

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

interface CollapsedChatFlyoutItemProps {
  chat: { id: string; href: string; name: string; isActive?: boolean; isUnread?: boolean }
  isCurrentRoute: boolean
  isMenuOpen?: boolean
  isEditing?: boolean
  editValue?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  isRenaming?: boolean
  onEditValueChange?: (value: string) => void
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditBlur?: () => void
  onContextMenu?: (e: ReactMouseEvent, chatId: string) => void
  onMorePointerDown?: () => void
  onMoreClick?: (e: ReactMouseEvent<HTMLButtonElement>, chatId: string) => void
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
  onOpenInNewTab?: () => void
  onRename?: () => void
  canRename?: boolean
}

const EDIT_ROW_CLASS = cn(
  chipVariants({ active: true, fullWidth: true }),
  'mx-0 min-w-0 cursor-default select-none text-small'
)

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
              className={chipVariants({ fullWidth: true })}
            >
              {icon}
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent side='right' align='start' sideOffset={8} {...hover.contentProps}>
          {primaryAction && (
            <>
              <DropdownMenuItem onSelect={primaryAction.onSelect}>
                <Plus className='size-[14px]' />
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

export function CollapsedChatFlyoutItem({
  chat,
  isCurrentRoute,
  isMenuOpen = false,
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
}: CollapsedChatFlyoutItemProps) {
  const showActions = chat.id !== 'new' && onMoreClick

  if (isEditing) {
    return (
      <div className={EDIT_ROW_CLASS}>
        <input
          aria-label={`Rename chat ${chat.name}`}
          ref={inputRef}
          value={editValue ?? chat.name}
          onChange={(e) => onEditValueChange?.(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-small outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
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
    <DropdownMenuItem
      asChild
      className={cn((isCurrentRoute || isMenuOpen) && 'bg-[var(--surface-active)]')}
      action={
        showActions ? (
          <DropdownMenuItemAction
            aria-label='Chat options'
            onPointerDown={onMorePointerDown}
            onClick={(e) => onMoreClick?.(e, chat.id)}
            className={cn(isMenuOpen && 'opacity-100')}
          >
            <MoreHorizontal />
          </DropdownMenuItemAction>
        ) : undefined
      }
    >
      <Link
        href={chat.href}
        onContextMenu={
          chat.id !== 'new' && onContextMenu ? (e) => onContextMenu(e, chat.id) : undefined
        }
      >
        <ConversationListItem
          title={chat.name}
          isActive={!!chat.isActive}
          isUnread={!!chat.isUnread}
        />
      </Link>
    </DropdownMenuItem>
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
  onOpenInNewTab,
  onRename,
  canRename = true,
}: CollapsedWorkflowFlyoutItemProps) {
  const hasActions = !!onOpenInNewTab || !!onRename
  const [actionsOpen, setActionsOpen] = useState(false)

  if (isEditing) {
    return (
      <div className={EDIT_ROW_CLASS}>
        <input
          aria-label={`Rename workflow ${workflow.name}`}
          ref={inputRef}
          value={editValue ?? workflow.name}
          onChange={(e) => onEditValueChange?.(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className='w-full min-w-0 border-0 bg-transparent p-0 text-[var(--text-body)] text-small outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
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
    <DropdownMenuItem
      asChild
      className={cn((isCurrentRoute || actionsOpen) && 'bg-[var(--surface-active)]')}
      action={
        hasActions ? (
          <DropdownMenuSub
            open={actionsOpen}
            onOpenChange={(open) => {
              if (!open) setActionsOpen(false)
            }}
          >
            <DropdownMenuSubTrigger asChild>
              <DropdownMenuItemAction
                aria-label='Workflow options'
                onClick={() => setActionsOpen((prev) => !prev)}
                className={cn(actionsOpen && 'opacity-100')}
              >
                <MoreHorizontal />
              </DropdownMenuItemAction>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {onOpenInNewTab && (
                <DropdownMenuItem onSelect={onOpenInNewTab}>
                  <SquareArrowUpRight className='size-[14px]' />
                  Open in new tab
                </DropdownMenuItem>
              )}
              {onRename && (
                <DropdownMenuItem
                  disabled={!canRename}
                  onSelect={(e) => {
                    e.preventDefault()
                    setActionsOpen(false)
                    onRename()
                  }}
                >
                  <Pencil className='size-[14px]' />
                  Rename
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : undefined
      }
    >
      <Link
        href={href}
        onContextMenu={
          hasActions
            ? (e) => {
                e.preventDefault()
                setActionsOpen(true)
              }
            : undefined
        }
      >
        <span className='min-w-0 flex-1 truncate'>{workflow.name}</span>
      </Link>
    </DropdownMenuItem>
  )
}

interface CollapsedFolderItemsProps {
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
  onWorkflowOpenInNewTab?: (workflow: WorkflowMetadata) => void
  onWorkflowRename?: (workflow: WorkflowMetadata) => void
  canRenameWorkflow?: boolean
}

/**
 * Renders folder flyouts for one level of the collapsed sidebar. A folder's
 * submenu interleaves its child folders and workflows by `sortOrder` — the same
 * single ordering the expanded sidebar and this menu's own root level use, so a
 * folder never jumps above a workflow the user dragged above it.
 */
export function CollapsedFolderItems(props: CollapsedFolderItemsProps) {
  const {
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
    onWorkflowOpenInNewTab,
    onWorkflowRename,
    canRenameWorkflow,
  } = props

  return (
    <>
      {nodes.map((folder) => {
        const folderWorkflows = workflowsByFolder[folder.id] || []
        const hasChildren = folder.children.length > 0 || folderWorkflows.length > 0

        if (!hasChildren) {
          return (
            <DropdownMenuItem key={folder.id} disabled>
              <Folder className='size-[14px]' />
              <span className='truncate'>{folder.name}</span>
            </DropdownMenuItem>
          )
        }

        return (
          <DropdownMenuSub key={folder.id}>
            <DropdownMenuSubTrigger className='focus:bg-[var(--surface-active)] data-[state=open]:bg-[var(--surface-active)]'>
              <Folder className='size-[14px]' />
              <span className='truncate'>{folder.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {interleaveSiblings(folder.children, folderWorkflows).map((child) =>
                child.kind === 'folder' ? (
                  <CollapsedFolderItems key={child.id} {...props} nodes={[child.node]} />
                ) : (
                  <CollapsedWorkflowFlyoutItem
                    key={child.id}
                    workflow={child.workflow}
                    href={`/workspace/${workspaceId}/w/${child.workflow.id}`}
                    isCurrentRoute={child.workflow.id === currentWorkflowId}
                    isEditing={child.workflow.id === editingWorkflowId}
                    editValue={editingValue}
                    inputRef={editInputRef}
                    isRenaming={isRenamingWorkflow}
                    onEditValueChange={onEditValueChange}
                    onEditKeyDown={onEditKeyDown}
                    onEditBlur={onEditBlur}
                    onOpenInNewTab={
                      onWorkflowOpenInNewTab
                        ? () => onWorkflowOpenInNewTab(child.workflow)
                        : undefined
                    }
                    onRename={onWorkflowRename ? () => onWorkflowRename(child.workflow) : undefined}
                    canRename={canRenameWorkflow}
                  />
                )
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}
