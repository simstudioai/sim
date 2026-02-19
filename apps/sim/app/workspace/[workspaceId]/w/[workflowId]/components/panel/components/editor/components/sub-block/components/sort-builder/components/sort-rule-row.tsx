import { Plus } from 'lucide-react'
import { Badge, Button, Combobox, type ComboboxOption, Label, Trash } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { SortRule } from '@/lib/table/query-builder/constants'

interface SortRuleRowProps {
  rule: SortRule
  index: number
  columns: ComboboxOption[]
  directionOptions: ComboboxOption[]
  isReadOnly: boolean
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof SortRule, value: string) => void
  onToggleCollapse: (id: string) => void
}

export function SortRuleRow({
  rule,
  index,
  columns,
  directionOptions,
  isReadOnly,
  onAdd,
  onRemove,
  onUpdate,
  onToggleCollapse,
}: SortRuleRowProps) {
  const getDirectionLabel = (value: string) => {
    const option = directionOptions.find((dir) => dir.value === value)
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
          {rule.collapsed && rule.column ? getColumnLabel(rule.column) : `Sort ${index + 1}`}
        </span>
        {rule.collapsed && rule.column && (
          <Badge variant='type' size='sm'>
            {getDirectionLabel(rule.direction)}
          </Badge>
        )}
      </div>
      <div className='flex items-center gap-[8px] pl-[8px]' onClick={(e) => e.stopPropagation()}>
        <Button variant='ghost' onClick={onAdd} disabled={isReadOnly} className='h-auto p-0'>
          <Plus className='h-[14px] w-[14px]' />
          <span className='sr-only'>Add Sort</span>
        </Button>
        <Button
          variant='ghost'
          onClick={() => onRemove(rule.id)}
          disabled={isReadOnly}
          className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
        >
          <Trash className='h-[14px] w-[14px]' />
          <span className='sr-only'>Delete Sort</span>
        </Button>
      </div>
    </div>
  )

  const renderContent = () => (
    <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
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
        <Label className='text-[13px]'>Direction</Label>
        <Combobox
          options={directionOptions}
          value={rule.direction}
          onChange={(v) => onUpdate(rule.id, 'direction', v as 'asc' | 'desc')}
          disabled={isReadOnly}
          placeholder='Select direction'
        />
      </div>
    </div>
  )

  return (
    <div
      data-sort-id={rule.id}
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
