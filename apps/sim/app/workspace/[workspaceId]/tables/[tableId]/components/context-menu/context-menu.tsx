import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { ArrowDown, ArrowUp, Duplicate, Pencil, Play, Trash } from '@/components/emcn/icons'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import type { ContextMenuState } from '../../types'

interface ContextMenuProps {
  contextMenu: ContextMenuState
  onClose: () => void
  onEditCell: () => void
  onDelete: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDuplicate: () => void
  selectedRowCount?: number
  disableEdit?: boolean
  disableInsert?: boolean
  disableDelete?: boolean
  workflows?: WorkflowMetadata[]
  onRunWorkflow?: (workflowId: string) => void
}

export function ContextMenu({
  contextMenu,
  onClose,
  onEditCell,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onDuplicate,
  selectedRowCount = 1,
  disableEdit = false,
  disableInsert = false,
  disableDelete = false,
  workflows,
  onRunWorkflow,
}: ContextMenuProps) {
  const deleteLabel = selectedRowCount > 1 ? `Delete ${selectedRowCount} rows` : 'Delete row'
  const hasWorkflows = workflows && workflows.length > 0
  const hasRow = contextMenu.row !== null

  return (
    <DropdownMenu
      open={contextMenu.isOpen}
      onOpenChange={(open) => !open && onClose()}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${contextMenu.position.x}px`,
            top: `${contextMenu.position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {contextMenu.columnName && (
          <DropdownMenuItem disabled={disableEdit} onSelect={onEditCell}>
            <Pencil />
            Edit cell
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={disableInsert} onSelect={onInsertAbove}>
          <ArrowUp />
          Insert row above
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disableInsert} onSelect={onInsertBelow}>
          <ArrowDown />
          Insert row below
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disableInsert || selectedRowCount > 1} onSelect={onDuplicate}>
          <Duplicate />
          Duplicate row
        </DropdownMenuItem>
        {onRunWorkflow && hasRow && hasWorkflows && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Play />
                Run Workflow
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {workflows.map((wf) => (
                  <DropdownMenuItem key={wf.id} onSelect={() => onRunWorkflow(wf.id)}>
                    <span
                      className='h-2 w-2 shrink-0 rounded-full'
                      style={{ backgroundColor: wf.color }}
                    />
                    {wf.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
          <Trash />
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
