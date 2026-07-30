'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Button, ChipDropdown, ChipInput } from '@sim/emcn'
import { Plus, X } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import type { ColumnDefinition, FilterRule, TablePredicate } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import {
  COMPARISON_OPERATORS,
  MULTI_SELECT_FILTER_OPERATORS,
  SINGLE_SELECT_FILTER_OPERATORS,
  VALUELESS_OPERATORS,
} from '@/lib/table/query-builder/constants'
import {
  filterRulesToPredicate,
  predicateToFilterRules,
} from '@/lib/table/query-builder/converters'

const SINGLE_SELECT_COMPARISON_OPERATORS = COMPARISON_OPERATORS.filter((o) =>
  SINGLE_SELECT_FILTER_OPERATORS.has(o.value)
)
const MULTI_SELECT_COMPARISON_OPERATORS = COMPARISON_OPERATORS.filter((o) =>
  MULTI_SELECT_FILTER_OPERATORS.has(o.value)
)

function selectFilterOperators(column: ColumnDefinition | undefined): Set<string> {
  return column?.multiple ? MULTI_SELECT_FILTER_OPERATORS : SINGLE_SELECT_FILTER_OPERATORS
}

interface TableFilterProps {
  columns: ColumnDefinition[]
  filter: TablePredicate | null
  onApply: (filter: TablePredicate | null) => void
  onClose: () => void
}

export function TableFilter({ columns, filter, onApply, onClose }: TableFilterProps) {
  const [rules, setRules] = useState<FilterRule[]>(() => {
    const fromFilter = predicateToFilterRules(filter)
    return fromFilter.length > 0 ? fromFilter : [createRule(columns)]
  })

  const rulesRef = useRef(rules)
  rulesRef.current = rules

  // `value` is the filter field key (column id); `label` is what the user sees.
  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: getColumnId(col), label: col.name })),
    [columns]
  )

  const columnById = useMemo(
    () => new Map(columns.map((col) => [getColumnId(col), col])),
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

  // Switching a rule's column across the select boundary changes what values and
  // operators are valid, so clear the value and coerce an unsupported operator
  // back to `eq` — otherwise a stale free-text value or a range operator would
  // apply against a select column and be rejected server-side.
  const handleColumnChange = useCallback(
    (id: string, columnId: string) => {
      setRules((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r
          const previous = columnById.get(r.column)
          const next = columnById.get(columnId)
          const wasSelect = previous?.type === 'select'
          const isSelect = next?.type === 'select'
          if (!wasSelect && !isSelect) return { ...r, column: columnId }
          // Single- and multi-select take different operators, so a switch
          // between them has to fall back too, not just select ↔ non-select.
          const allowed = selectFilterOperators(next)
          const fallback = next?.multiple ? 'contains' : 'eq'
          const operator = isSelect && !allowed.has(r.operator) ? fallback : r.operator
          return { ...r, column: columnId, operator, value: '' }
        })
      )
    },
    [columnById]
  )

  const handleToggleLogical = useCallback((id: string) => {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, logicalOperator: r.logicalOperator === 'and' ? 'or' : 'and' } : r
      )
    )
  }, [])

  const handleApply = useCallback(() => {
    const validRules = rulesRef.current.filter(
      (r) => r.column && (r.value || VALUELESS_OPERATORS.has(r.operator))
    )
    onApply(filterRulesToPredicate(validRules, columns))
  }, [columns, onApply])

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
            columnById={columnById}
            onUpdate={handleUpdate}
            onColumnChange={handleColumnChange}
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
            <Plus className='mr-1 size-[10px]' />
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
  columnById: ReadonlyMap<string, ColumnDefinition>
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onColumnChange: (id: string, columnId: string) => void
  onRemove: (id: string) => void
  onApply: () => void
  onToggleLogical: (id: string) => void
}

const FilterRuleRow = memo(function FilterRuleRow({
  rule,
  isFirst,
  columns,
  columnById,
  onUpdate,
  onColumnChange,
  onRemove,
  onApply,
  onToggleLogical,
}: FilterRuleRowProps) {
  // Keep a stale column id selectable/visible (e.g. after the column was
  // removed) instead of falling back to the placeholder while the rule still
  // filters on it.
  const columnOptions =
    rule.column && !columns.some((col) => col.value === rule.column)
      ? [...columns, { value: rule.column, label: rule.column }]
      : columns

  const selectedColumn = columnById.get(rule.column)
  const isSelect = selectedColumn?.type === 'select'
  const operatorOptions = !isSelect
    ? COMPARISON_OPERATORS
    : selectedColumn?.multiple
      ? MULTI_SELECT_COMPARISON_OPERATORS
      : SINGLE_SELECT_COMPARISON_OPERATORS

  // A stale id (option since deleted) stays selectable so the rule still shows.
  const selectValueOptions = isSelect
    ? (() => {
        const opts = (selectedColumn.options ?? []).map((o) => ({ value: o.id, label: o.name }))
        return rule.value && !opts.some((o) => o.value === rule.value)
          ? [...opts, { value: rule.value, label: rule.value }]
          : opts
      })()
    : []

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

      <ChipDropdown
        options={columnOptions}
        value={rule.column}
        onChange={(value) => onColumnChange(rule.id, value)}
        placeholder='Column'
        align='start'
        matchTriggerWidth={false}
        className='min-w-[100px]'
      />

      <ChipDropdown
        options={operatorOptions}
        value={rule.operator}
        onChange={(value) => onUpdate(rule.id, 'operator', value)}
        placeholder='Operator'
        align='start'
        matchTriggerWidth={false}
        className='min-w-[90px]'
      />

      {VALUELESS_OPERATORS.has(rule.operator) ? (
        <div className='h-[30px] flex-1' />
      ) : isSelect ? (
        <ChipDropdown
          options={selectValueOptions}
          value={rule.value}
          onChange={(value) => onUpdate(rule.id, 'value', value)}
          placeholder='Select a value'
          align='start'
          matchTriggerWidth={false}
          className='min-w-[100px] flex-1'
        />
      ) : (
        <ChipInput
          value={rule.value}
          onChange={(e) => onUpdate(rule.id, 'value', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onApply()
          }}
          placeholder='Enter a value'
          className='flex-1'
        />
      )}

      <Button
        variant='ghost'
        size='sm'
        onClick={() => onRemove(rule.id)}
        className='!p-1 size-7 shrink-0'
        aria-label='Remove filter'
      >
        <X className='size-[12px]' />
      </Button>
    </div>
  )
})

function createRule(columns: ColumnDefinition[]): FilterRule {
  const first = columns[0]
  return {
    id: generateShortId(),
    logicalOperator: 'and',
    column: first ? getColumnId(first) : '',
    // A multi-select can't be compared for equality — default it to membership.
    operator: first?.type === 'select' && first.multiple ? 'contains' : 'eq',
    value: '',
  }
}
