import { useRef } from 'react'
import { Plus } from 'lucide-react'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Trash,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { FilterRule } from '@/lib/table/query-builder/constants'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import type { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

interface FilterRuleRowProps {
  blockId: string
  subBlockId: string
  rule: FilterRule
  index: number
  columns: ComboboxOption[]
  comparisonOptions: ComboboxOption[]
  logicalOptions: ComboboxOption[]
  isReadOnly: boolean
  isPreview: boolean
  disabled: boolean
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onToggleCollapse: (id: string) => void
  inputController: ReturnType<typeof useSubBlockInput>
}

export function FilterRuleRow({
  blockId,
  rule,
  index,
  columns,
  comparisonOptions,
  logicalOptions,
  isReadOnly,
  onAdd,
  onRemove,
  onUpdate,
  onToggleCollapse,
  inputController,
}: FilterRuleRowProps) {
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const valueInputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const syncOverlayScroll = (scrollLeft: number) => {
    if (overlayRef.current) overlayRef.current.scrollLeft = scrollLeft
  }

  const cellKey = `filter-${rule.id}-value`
  const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
  const handlers = inputController.fieldHelpers.createFieldHandlers(
    cellKey,
    rule.value,
    (newValue) => onUpdate(rule.id, 'value', newValue)
  )
  const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
    cellKey,
    rule.value,
    (newValue) => onUpdate(rule.id, 'value', newValue)
  )

  const getOperatorLabel = (value: string) => {
    const option = comparisonOptions.find((op) => op.value === value)
    return option?.label || value
  }

  const getColumnLabel = (value: string) => {
    const option = columns.find((col) => col.value === value)
    return option?.label || value
  }

  const renderHeader = () => (
    <div
      className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-[10px] py-[5px]'
      onClick={() => onToggleCollapse(rule.id)}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
          {rule.collapsed && rule.column ? getColumnLabel(rule.column) : `Condition ${index + 1}`}
        </span>
        {rule.collapsed && rule.column && (
          <Badge variant='type' size='sm'>
            {getOperatorLabel(rule.operator)}
          </Badge>
        )}
      </div>
      <div className='flex items-center gap-[8px] pl-[8px]' onClick={(e) => e.stopPropagation()}>
        <Button variant='ghost' onClick={onAdd} disabled={isReadOnly} className='h-auto p-0'>
          <Plus className='h-[14px] w-[14px]' />
          <span className='sr-only'>Add Condition</span>
        </Button>
        <Button
          variant='ghost'
          onClick={() => onRemove(rule.id)}
          disabled={isReadOnly}
          className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
        >
          <Trash className='h-[14px] w-[14px]' />
          <span className='sr-only'>Delete Condition</span>
        </Button>
      </div>
    </div>
  )

  const renderValueInput = () => (
    <div className='relative'>
      <Input
        ref={valueInputRef}
        value={rule.value}
        onChange={handlers.onChange}
        onKeyDown={handlers.onKeyDown}
        onDrop={handlers.onDrop}
        onDragOver={handlers.onDragOver}
        onFocus={handlers.onFocus}
        onScroll={(e) => syncOverlayScroll(e.currentTarget.scrollLeft)}
        onPaste={() =>
          setTimeout(() => {
            if (valueInputRef.current) {
              syncOverlayScroll(valueInputRef.current.scrollLeft)
            }
          }, 0)
        }
        disabled={isReadOnly}
        autoComplete='off'
        placeholder='Enter value'
        className='allow-scroll w-full overflow-auto text-transparent caret-foreground'
      />
      <div
        ref={overlayRef}
        className={cn(
          'absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm',
          !isReadOnly && 'pointer-events-none'
        )}
      >
        <div className='w-full whitespace-pre' style={{ minWidth: 'fit-content' }}>
          {formatDisplayText(
            rule.value,
            accessiblePrefixes ? { accessiblePrefixes } : { highlightAll: true }
          )}
        </div>
      </div>
      {fieldState.showTags && (
        <TagDropdown
          visible={fieldState.showTags}
          onSelect={tagSelectHandler}
          blockId={blockId}
          activeSourceBlockId={fieldState.activeSourceBlockId}
          inputValue={rule.value}
          cursorPosition={fieldState.cursorPosition}
          onClose={() => inputController.fieldHelpers.hideFieldDropdowns(cellKey)}
          inputRef={valueInputRef.current ? { current: valueInputRef.current } : undefined}
        />
      )}
    </div>
  )

  const renderContent = () => (
    <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
      {index > 0 && (
        <div className='flex flex-col gap-[6px]'>
          <Label className='text-[13px]'>Logic</Label>
          <Combobox
            options={logicalOptions}
            value={rule.logicalOperator}
            onChange={(v) => onUpdate(rule.id, 'logicalOperator', v as 'and' | 'or')}
            disabled={isReadOnly}
          />
        </div>
      )}

      <div className='flex flex-col gap-[6px]'>
        <Label className='text-[13px]'>Column</Label>
        <Combobox
          options={columns}
          value={rule.column}
          onChange={(v) => onUpdate(rule.id, 'column', v)}
          disabled={isReadOnly}
          placeholder='Select column'
        />
      </div>

      <div className='flex flex-col gap-[6px]'>
        <Label className='text-[13px]'>Operator</Label>
        <Combobox
          options={comparisonOptions}
          value={rule.operator}
          onChange={(v) => onUpdate(rule.id, 'operator', v)}
          disabled={isReadOnly}
          placeholder='Select operator'
        />
      </div>

      <div className='flex flex-col gap-[6px]'>
        <Label className='text-[13px]'>Value</Label>
        {renderValueInput()}
      </div>
    </div>
  )

  return (
    <div
      data-filter-id={rule.id}
      className={cn(
        'rounded-[4px] border border-[var(--border-1)]',
        rule.collapsed ? 'overflow-hidden' : 'overflow-visible'
      )}
    >
      {renderHeader()}
      {!rule.collapsed && renderContent()}
    </div>
  )
}
