'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import { useTranslations } from 'next-intl'
import { Button, ChipDropdown, ChipInput } from '@/components/emcn'
import { Plus, X } from '@/components/emcn/icons'
import type { ColumnDefinition, Filter, FilterRule } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { COMPARISON_OPERATORS, VALUELESS_OPERATORS } from '@/lib/table/query-builder/constants'
import { filterRulesToFilter, filterToRules } from '@/lib/table/query-builder/converters'

interface TableFilterProps {
  columns: ColumnDefinition[]
  filter: Filter | null
  onApply: (filter: Filter | null) => void
  onClose: () => void
}

export function TableFilter({ columns, filter, onApply, onClose }: TableFilterProps) {
  const t = useTranslations('auto')
  const [rules, setRules] = useState<FilterRule[]>(() => {
    const fromFilter = filterToRules(filter)
    return fromFilter.length > 0 ? fromFilter : [createRule(columns)]
  })

  const rulesRef = useRef(rules)
  rulesRef.current = rules

  // `value` is the filter field key (column id); `label` is what the user sees.
  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: getColumnId(col), label: col.name })),
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
    const validRules = rulesRef.current.filter(
      (r) => r.column && (r.value || VALUELESS_OPERATORS.has(r.operator))
    )
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
            <Plus className='mr-1 size-[10px]' />
            {t('add_filter')}
          </Button>
          <div className='flex items-center gap-1.5'>
            {filter !== null && (
              <Button
                variant='ghost'
                size='sm'
                onClick={handleClear}
                className='px-2 py-1 text-[var(--text-secondary)] text-xs'
              >
                {t('clear_filters')}
              </Button>
            )}
            <Button variant='default' size='sm' onClick={handleApply} className='text-xs'>
              {t('apply_filter')}
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
  const t = useTranslations('auto')
  // Keep a stale column id selectable/visible (e.g. after the column was
  // removed) instead of falling back to the placeholder while the rule still
  // filters on it.
  const columnOptions =
    rule.column && !columns.some((col) => col.value === rule.column)
      ? [...columns, { value: rule.column, label: rule.column }]
      : columns

  return (
    <div className='flex items-center gap-1.5'>
      {isFirst ? (
        <span className='w-[42px] shrink-0 text-right text-[var(--text-muted)] text-xs'>
          {t('where')}
        </span>
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
        onChange={(value) => onUpdate(rule.id, 'column', value)}
        placeholder={t('column')}
        align='start'
        matchTriggerWidth={false}
        className='min-w-[100px]'
      />

      <ChipDropdown
        options={COMPARISON_OPERATORS}
        value={rule.operator}
        onChange={(value) => onUpdate(rule.id, 'operator', value)}
        placeholder={t('operator')}
        align='start'
        matchTriggerWidth={false}
        className='min-w-[90px]'
      />

      {VALUELESS_OPERATORS.has(rule.operator) ? (
        <div className='h-[30px] flex-1' />
      ) : (
        <ChipInput
          value={rule.value}
          onChange={(e) => onUpdate(rule.id, 'value', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onApply()
          }}
          placeholder={t('enter_a_value')}
          className='flex-1'
        />
      )}

      <Button
        variant='ghost'
        size='sm'
        onClick={() => onRemove(rule.id)}
        className='!p-1 size-7 shrink-0'
        aria-label={t('remove_filter')}
      >
        <X className='size-[12px]' />
      </Button>
    </div>
  )
})

function createRule(columns: ColumnDefinition[]): FilterRule {
  return {
    id: generateShortId(),
    logicalOperator: 'and',
    column: columns[0] ? getColumnId(columns[0]) : '',
    operator: 'eq',
    value: '',
  }
}
