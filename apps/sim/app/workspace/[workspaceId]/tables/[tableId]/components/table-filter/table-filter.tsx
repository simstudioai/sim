'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { ChevronDown, Plus } from '@/components/emcn/icons'
import { generateShortId } from '@/lib/core/utils/uuid'
import type { Filter, FilterRule } from '@/lib/table'
import { COMPARISON_OPERATORS } from '@/lib/table/query-builder/constants'
import { filterRulesToFilter, filterToRules } from '@/lib/table/query-builder/converters'

const OPERATOR_LABELS = Object.fromEntries(
  COMPARISON_OPERATORS.map((op) => [op.value, op.label])
) as Record<string, string>

interface TableFilterProps {
  columns: Array<{ name: string; type: string }>
  filter: Filter | null
  onApply: (filter: Filter | null) => void
  onClose: () => void
}

export function TableFilter({ columns, filter, onApply, onClose }: TableFilterProps) {
  const [rules, setRules] = useState<FilterRule[]>(() => {
    const fromFilter = filterToRules(filter)
    return fromFilter.length > 0 ? fromFilter : [createRule(columns)]
  })

  const rulesRef = useRef(rules)
  rulesRef.current = rules

  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: col.name, label: col.name })),
    [columns]
  )

  const handleAdd = useCallback(() => {
    setRules((prev) => [...prev, createRule(columns)])
  }, [columns])

  const handleRemove = useCallback(
    (id: string) => {
      const next = rulesRef.current.filter((r) => r.id !== id)
      if (next.length === 0) {
        onApply(null)
        onClose()
        setRules([createRule(columns)])
      } else {
        setRules(next)
      }
    },
    [columns, onApply, onClose]
  )

  const handleUpdate = useCallback((id: string, field: keyof FilterRule, value: string) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }, [])

  const handleToggleLogical = useCallback((id: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, logicalOperator: r.logicalOperator === 'and' ? 'or' : 'and' } : r
      )
    )
  }, [])

  const handleApply = useCallback(() => {
    const validRules = rulesRef.current.filter((r) => r.column && r.value)
    onApply(filterRulesToFilter(validRules))
  }, [onApply])

  const handleClear = useCallback(() => {
    setRules([createRule(columns)])
    onApply(null)
  }, [columns, onApply])

  return (
    <div className='border-[var(--border)] border-b bg-[var(--bg)] px-4 py-2'>
      <div className='flex flex-col gap-1'>
        {rules.map((rule, index) => (
          <FilterRuleRow
            key={rule.id}
            rule={rule}
            isFirst={index === 0}
            columns={columnOptions}
            onUpdate={handleUpdate}
            onRemove={handleRemove}
            onApply={handleApply}
            onToggleLogical={handleToggleLogical}
          />
        ))}

        <div className='mt-1 flex items-center justify-between'>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleAdd}
            className='px-2 py-1 text-[var(--text-secondary)] text-xs'
          >
            <Plus className='mr-1 h-[10px] w-[10px]' />
            Add filter
          </Button>
          <div className='flex items-center gap-1.5'>
            {filter !== null && (
              <Button
                variant='ghost'
                size='sm'
                onClick={handleClear}
                className='px-2 py-1 text-[var(--text-secondary)] text-xs'
              >
                Clear filters
              </Button>
            )}
            <Button variant='default' size='sm' onClick={handleApply} className='text-xs'>
              Apply filter
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface FilterRuleRowProps {
  rule: FilterRule
  isFirst: boolean
  columns: Array<{ value: string; label: string }>
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onRemove: (id: string) => void
  onApply: () => void
  onToggleLogical: (id: string) => void
}

const FilterRuleRow = memo(function FilterRuleRow({
  rule,
  isFirst,
  columns,
  onUpdate,
  onRemove,
  onApply,
  onToggleLogical,
}: FilterRuleRowProps) {
  return (
    <div className='flex items-center gap-1.5'>
      {isFirst ? (
        <span className='w-[42px] shrink-0 text-right text-[var(--text-muted)] text-xs'>Where</span>
      ) : (
        <button
          onClick={() => onToggleLogical(rule.id)}
          className='w-[42px] shrink-0 rounded-full py-0.5 text-right font-medium text-[10px] text-[var(--text-muted)] uppercase tracking-wide transition-colors hover:text-[var(--text-secondary)]'
        >
          {rule.logicalOperator}
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className='flex h-[28px] min-w-[100px] items-center justify-between rounded-[5px] border border-[var(--border)] bg-transparent px-2 text-[var(--text-secondary)] text-xs outline-none hover-hover:border-[var(--border-1)]'>
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
          <button className='flex h-[28px] min-w-[90px] items-center justify-between rounded-[5px] border border-[var(--border)] bg-transparent px-2 text-[var(--text-secondary)] text-xs outline-none hover-hover:border-[var(--border-1)]'>
            <span className='truncate'>{OPERATOR_LABELS[rule.operator] ?? rule.operator}</span>
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
          if (e.key === 'Enter') onApply()
        }}
        placeholder='Enter a value'
        className='h-[28px] flex-1 rounded-[5px] border border-[var(--border)] bg-transparent px-2 text-[var(--text-secondary)] text-xs outline-none placeholder:text-[var(--text-subtle)] hover-hover:border-[var(--border-1)] focus:border-[var(--border-1)]'
      />

      <button
        onClick={() => onRemove(rule.id)}
        className='flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] transition-colors hover-hover:bg-[var(--surface-4)] hover-hover:text-[var(--text-primary)]'
      >
        <X className='h-[12px] w-[12px]' />
      </button>
    </div>
  )
})

function createRule(columns: Array<{ name: string }>): FilterRule {
  return {
    id: generateShortId(),
    logicalOperator: 'and',
    column: columns[0]?.name ?? '',
    operator: 'eq',
    value: '',
  }
}
