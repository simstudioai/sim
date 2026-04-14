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
import type { ManualTriggerWorkflow } from '@/hooks/queries/tables'
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
  manualTriggerWorkflows?: ManualTriggerWorkflow[]
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
  manualTriggerWorkflows,
  onRunWorkflow,
}: ContextMenuProps) {
  const deleteLabel = selectedRowCount > 1 ? `Delete ${selectedRowCount} rows` : 'Delete row'
  const hasWorkflows = manualTriggerWorkflows && manualTriggerWorkflows.length > 0
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
                {manualTriggerWorkflows.map((wf) => (
                  <DropdownMenuItem
                    key={wf.workflowId}
                    onSelect={() => onRunWorkflow(wf.workflowId)}
                  >
                    <span
                      className='h-2 w-2 shrink-0 rounded-full'
                      style={{ backgroundColor: wf.workflowColor }}
                    />
                    {wf.workflowName}
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
