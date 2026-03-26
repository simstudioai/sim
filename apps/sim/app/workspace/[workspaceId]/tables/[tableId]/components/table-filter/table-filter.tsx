'use client'

import { useCallback, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { nanoid } from 'nanoid'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { ChevronDown, Plus } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { Filter, FilterRule } from '@/lib/table'
import { COMPARISON_OPERATORS } from '@/lib/table/query-builder/constants'
import { filterRulesToFilter } from '@/lib/table/query-builder/converters'

const OPERATOR_LABELS: Record<string, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: '∋',
  in: '∈',
} as const

interface TableFilterProps {
  columns: Array<{ name: string; type: string }>
  onApply: (filter: Filter | null) => void
}

export function TableFilter({ columns, onApply }: TableFilterProps) {
  const [rules, setRules] = useState<FilterRule[]>(() => [createRule(columns)])

  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: col.name, label: col.name })),
    [columns]
  )

  const handleAdd = useCallback(() => {
    setRules((prev) => [...prev, createRule(columns)])
  }, [columns])

  const handleRemove = useCallback(
    (id: string) => {
      setRules((prev) => {
        const next = prev.filter((r) => r.id !== id)
        return next.length === 0 ? [createRule(columns)] : next
      })
    },
    [columns]
  )

  const handleUpdate = useCallback((id: string, field: keyof FilterRule, value: string) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }, [])

  const handleApply = useCallback(() => {
    const validRules = rules.filter((r) => r.column && r.value)
    onApply(filterRulesToFilter(validRules))
  }, [rules, onApply])

  return (
    <div className='flex flex-col gap-1.5 p-2'>
      {rules.map((rule) => (
        <FilterRuleRow
          key={rule.id}
          rule={rule}
          columns={columnOptions}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onApply={handleApply}
        />
      ))}

      <div className='flex items-center justify-between gap-3'>
        <Button
          variant='ghost'
          size='sm'
          onClick={handleAdd}
          className={cn(
            'border border-[var(--border)] border-dashed px-2 py-[3px] text-[var(--text-secondary)] text-xs'
          )}
        >
          <Plus className='mr-1 h-[10px] w-[10px]' />
          Add filter
        </Button>

        <Button variant='default' size='sm' onClick={handleApply} className='text-xs'>
          Apply filter
        </Button>
      </div>
    </div>
  )
}

interface FilterRuleRowProps {
  rule: FilterRule
  columns: Array<{ value: string; label: string }>
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onRemove: (id: string) => void
  onApply: () => void
}

function FilterRuleRow({ rule, columns, onUpdate, onRemove, onApply }: FilterRuleRowProps) {
  return (
    <div className='flex items-center gap-1'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className='flex h-[30px] min-w-[100px] items-center justify-between rounded-[5px] border border-[var(--border)] bg-transparent px-2 text-[var(--text-secondary)] text-xs outline-none hover-hover:border-[var(--border-1)]'>
            <span className='truncate'>{rule.column || 'Column'}</span>
            <ChevronDown className='ml-1 h-[10px] w-[10px] shrink-0 text-[var(--text-icon)]' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          {columns.map((col) => (
            <DropdownMenuItem
              key={col.value}
              onSelect={() => onUpdate(rule.id, 'column', col.value)}
            >
              {col.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className='flex h-[30px] min-w-[50px] items-center justify-between rounded-[5px] border border-[var(--border)] bg-transparent px-2 text-[var(--text-secondary)] text-xs outline-none hover-hover:border-[var(--border-1)]'>
            <span>{OPERATOR_LABELS[rule.operator] ?? rule.operator}</span>
            <ChevronDown className='ml-1 h-[10px] w-[10px] shrink-0 text-[var(--text-icon)]' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          {COMPARISON_OPERATORS.map((op) => (
            <DropdownMenuItem
              key={op.value}
              onSelect={() => onUpdate(rule.id, 'operator', op.value)}
            >
              {op.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        type='text'
        value={rule.value}
        onChange={(e) => onUpdate(rule.id, 'value', e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleApply()
        }}
        placeholder='Enter a value'
        className='h-[30px] min-w-[160px] flex-1 rounded-[5px] border border-[var(--border)] bg-transparent px-2 text-[var(--text-secondary)] text-xs outline-none placeholder:text-[var(--text-subtle)] hover-hover:border-[var(--border-1)] focus:border-[var(--border-1)]'
      />

      <button
        onClick={() => onRemove(rule.id)}
        className='flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] transition-colors hover-hover:bg-[var(--surface-4)] hover-hover:text-[var(--text-primary)]'
      >
        <X className='h-[12px] w-[12px]' />
      </button>
    </div>
  )

  function handleApply() {
    onApply()
  }
}

function createRule(columns: Array<{ name: string }>): FilterRule {
  return {
    id: nanoid(),
    logicalOperator: 'and',
    column: columns[0]?.name ?? '',
    operator: 'eq',
    value: '',
  }
}
