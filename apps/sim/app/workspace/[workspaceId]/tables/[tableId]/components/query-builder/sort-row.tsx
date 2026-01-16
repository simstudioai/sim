'use client'

import { ArrowDownAZ, ArrowUpAZ, X } from 'lucide-react'
import { Button, Combobox } from '@/components/emcn'
import type { SortRule } from '@/lib/table/filters/constants'

interface SortRowProps {
  sortRule: SortRule
  columnOptions: Array<{ value: string; label: string }>
  sortDirectionOptions: Array<{ value: string; label: string }>
  onChange: (rule: SortRule | null) => void
  onRemove: () => void
}

export function SortRow({
  sortRule,
  columnOptions,
  sortDirectionOptions,
  onChange,
  onRemove,
}: SortRowProps) {
  return (
    <div className='flex items-center gap-[8px]'>
      <Button
        variant='ghost'
        size='sm'
        onClick={onRemove}
        className='h-[28px] w-[28px] shrink-0 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      >
        <X className='h-[12px] w-[12px]' />
      </Button>

      <div className='w-[80px] shrink-0'>
        <Combobox size='sm' options={[{ value: 'order', label: 'order' }]} value='order' disabled />
      </div>

      <div className='w-[140px] shrink-0'>
        <Combobox
          size='sm'
          options={columnOptions}
          value={sortRule.column}
          onChange={(value) => onChange({ ...sortRule, column: value })}
          placeholder='Column'
        />
      </div>

      <div className='w-[130px] shrink-0'>
        <Combobox
          size='sm'
          options={sortDirectionOptions}
          value={sortRule.direction}
          onChange={(value) => onChange({ ...sortRule, direction: value as 'asc' | 'desc' })}
        />
      </div>

      <div className='flex items-center text-[12px] text-[var(--text-tertiary)]'>
        {sortRule.direction === 'asc' ? (
          <ArrowUpAZ className='h-[14px] w-[14px]' />
        ) : (
          <ArrowDownAZ className='h-[14px] w-[14px]' />
        )}
      </div>
    </div>
  )
}
