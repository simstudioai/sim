'use client'

import { X } from 'lucide-react'
import { Button, Combobox, Input } from '@/components/emcn'
import type { FilterRule } from '@/lib/table/filters/constants'

interface FilterRowProps {
  rule: FilterRule
  index: number
  columnOptions: Array<{ value: string; label: string }>
  comparisonOptions: Array<{ value: string; label: string }>
  logicalOptions: Array<{ value: string; label: string }>
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onRemove: (id: string) => void
  onApply: () => void
}

export function FilterRow({
  rule,
  index,
  columnOptions,
  comparisonOptions,
  logicalOptions,
  onUpdate,
  onRemove,
  onApply,
}: FilterRowProps) {
  return (
    <div className='flex items-center gap-[8px]'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onRemove(rule.id)}
        className='h-[28px] w-[28px] shrink-0 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      >
        <X className='h-[12px] w-[12px]' />
      </Button>

      <div className='w-[80px] shrink-0'>
        {index === 0 ? (
          <Combobox
            size='sm'
            options={[{ value: 'where', label: 'where' }]}
            value='where'
            disabled
          />
        ) : (
          <Combobox
            size='sm'
            options={logicalOptions}
            value={rule.logicalOperator}
            onChange={(value) => onUpdate(rule.id, 'logicalOperator', value as 'and' | 'or')}
          />
        )}
      </div>

      <div className='w-[140px] shrink-0'>
        <Combobox
          size='sm'
          options={columnOptions}
          value={rule.column}
          onChange={(value) => onUpdate(rule.id, 'column', value)}
          placeholder='Column'
        />
      </div>

      <div className='w-[130px] shrink-0'>
        <Combobox
          size='sm'
          options={comparisonOptions}
          value={rule.operator}
          onChange={(value) => onUpdate(rule.id, 'operator', value)}
        />
      </div>

      <Input
        className='h-[28px] min-w-[200px] flex-1 text-[12px]'
        value={rule.value}
        onChange={(e) => onUpdate(rule.id, 'value', e.target.value)}
        placeholder='Value'
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onApply()
          }
        }}
      />
    </div>
  )
}
