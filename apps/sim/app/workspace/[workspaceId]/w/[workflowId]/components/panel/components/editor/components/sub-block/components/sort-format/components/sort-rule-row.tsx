import { X } from 'lucide-react'
import { Button, Combobox, type ComboboxOption } from '@/components/emcn'
import type { SortRule } from '@/lib/table/filters/constants'

interface SortRuleRowProps {
  rule: SortRule
  index: number
  columns: ComboboxOption[]
  directionOptions: ComboboxOption[]
  isReadOnly: boolean
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof SortRule, value: string) => void
}

export function SortRuleRow({
  rule,
  index,
  columns,
  directionOptions,
  isReadOnly,
  onRemove,
  onUpdate,
}: SortRuleRowProps) {
  return (
    <div className='flex items-center gap-[6px]'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onRemove(rule.id)}
        disabled={isReadOnly}
        className='h-[24px] w-[24px] shrink-0 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      >
        <X className='h-[12px] w-[12px]' />
      </Button>

      <div className='w-[90px] shrink-0'>
        <Combobox
          size='sm'
          options={[{ value: String(index + 1), label: index === 0 ? 'order by' : 'then by' }]}
          value={String(index + 1)}
          disabled
        />
      </div>

      <div className='min-w-[120px] flex-1'>
        <Combobox
          size='sm'
          options={columns}
          value={rule.column}
          onChange={(v) => onUpdate(rule.id, 'column', v)}
          placeholder='Column'
          disabled={isReadOnly}
        />
      </div>

      <div className='w-[110px] shrink-0'>
        <Combobox
          size='sm'
          options={directionOptions}
          value={rule.direction}
          onChange={(v) => onUpdate(rule.id, 'direction', v as 'asc' | 'desc')}
          disabled={isReadOnly}
        />
      </div>
    </div>
  )
}
