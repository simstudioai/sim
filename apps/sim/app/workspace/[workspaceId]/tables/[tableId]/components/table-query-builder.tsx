'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Loader2, Plus, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button, Combobox, Input } from '@/components/emcn'
import type { FilterRule, SortRule } from '@/lib/table/filters/constants'
import { useFilterBuilder } from '@/lib/table/filters/use-builder'
import { filterRulesToFilter, sortRuleToSort } from '@/lib/table/filters/utils'
import type { ColumnDefinition, Filter, Sort } from '@/lib/table/types'

export interface BuilderQueryResult {
  filter: Filter | null
  sort: Sort | null
}

type Column = Pick<ColumnDefinition, 'name' | 'type'>

interface TableQueryBuilderProps {
  columns: Column[]
  onApply: (options: BuilderQueryResult) => void
  onAddRow: () => void
  isLoading?: boolean
}

export function TableQueryBuilder({
  columns,
  onApply,
  onAddRow,
  isLoading = false,
}: TableQueryBuilderProps) {
  const [rules, setRules] = useState<FilterRule[]>([])
  const [sortRule, setSortRule] = useState<SortRule | null>(null)

  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: col.name, label: col.name })),
    [columns]
  )

  const {
    comparisonOptions,
    logicalOptions,
    sortDirectionOptions,
    addRule: handleAddRule,
    removeRule: handleRemoveRule,
    updateRule: handleUpdateRule,
  } = useFilterBuilder({
    columns: columnOptions,
    rules,
    setRules,
  })

  const handleAddSort = useCallback(() => {
    setSortRule({
      id: nanoid(),
      column: columns[0]?.name || '',
      direction: 'asc',
    })
  }, [columns])

  const handleRemoveSort = useCallback(() => {
    setSortRule(null)
  }, [])

  const handleApply = useCallback(() => {
    const filter = filterRulesToFilter(rules)
    const sort = sortRuleToSort(sortRule)
    onApply({ filter, sort })
  }, [rules, sortRule, onApply])

  const handleClear = useCallback(() => {
    setRules([])
    setSortRule(null)
    onApply({
      filter: null,
      sort: null,
    })
  }, [onApply])

  const hasChanges = rules.length > 0 || sortRule !== null

  return (
    <div className='flex flex-col gap-[8px]'>
      {rules.map((rule, index) => (
        <FilterRuleRow
          key={rule.id}
          rule={rule}
          index={index}
          columnOptions={columnOptions}
          comparisonOptions={comparisonOptions}
          logicalOptions={logicalOptions}
          onUpdate={handleUpdateRule}
          onRemove={handleRemoveRule}
          onApply={handleApply}
        />
      ))}

      {sortRule && (
        <SortRuleRow
          sortRule={sortRule}
          columnOptions={columnOptions}
          sortDirectionOptions={sortDirectionOptions}
          onChange={setSortRule}
          onRemove={handleRemoveSort}
        />
      )}

      <div className='flex items-center gap-[8px]'>
        <Button variant='default' size='sm' onClick={onAddRow}>
          <Plus className='mr-[4px] h-[12px] w-[12px]' />
          Add row
        </Button>

        <Button variant='default' size='sm' onClick={handleAddRule}>
          <Plus className='mr-[4px] h-[12px] w-[12px]' />
          Add filter
        </Button>

        {!sortRule && (
          <Button variant='default' size='sm' onClick={handleAddSort}>
            <ArrowUpAZ className='mr-[4px] h-[12px] w-[12px]' />
            Add sort
          </Button>
        )}

        {hasChanges && (
          <>
            <Button variant='default' size='sm' onClick={handleApply} disabled={isLoading}>
              {isLoading && <Loader2 className='mr-[4px] h-[12px] w-[12px] animate-spin' />}
              {isLoading ? 'Applying...' : 'Apply'}
            </Button>

            <button
              onClick={handleClear}
              className='text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
            >
              Clear all
            </button>
          </>
        )}
      </div>
    </div>
  )
}

interface FilterRuleRowProps {
  rule: FilterRule
  index: number
  columnOptions: Array<{ value: string; label: string }>
  comparisonOptions: Array<{ value: string; label: string }>
  logicalOptions: Array<{ value: string; label: string }>
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onRemove: (id: string) => void
  onApply: () => void
}

function FilterRuleRow({
  rule,
  index,
  columnOptions,
  comparisonOptions,
  logicalOptions,
  onUpdate,
  onRemove,
  onApply,
}: FilterRuleRowProps) {
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

interface SortRuleRowProps {
  sortRule: SortRule
  columnOptions: Array<{ value: string; label: string }>
  sortDirectionOptions: Array<{ value: string; label: string }>
  onChange: (rule: SortRule | null) => void
  onRemove: () => void
}

function SortRuleRow({
  sortRule,
  columnOptions,
  sortDirectionOptions,
  onChange,
  onRemove,
}: SortRuleRowProps) {
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
