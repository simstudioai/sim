'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowUpAZ, Loader2, Plus } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button } from '@/components/emcn'
import type { FilterRule, SortRule } from '@/lib/table/query-builder/constants'
import { filterRulesToFilter, sortRuleToSort } from '@/lib/table/query-builder/converters'
import { useFilterBuilder } from '@/lib/table/query-builder/use-query-builder'
import type { ColumnDefinition } from '@/lib/table/types'
import type { QueryOptions } from '../../lib/types'
import { FilterRow } from './filter-row'
import { SortRow } from './sort-row'

type Column = Pick<ColumnDefinition, 'name' | 'type'>

interface QueryBuilderProps {
  columns: Column[]
  onApply: (options: QueryOptions) => void
  onAddRow: () => void
  isLoading?: boolean
}

export function QueryBuilder({ columns, onApply, onAddRow, isLoading = false }: QueryBuilderProps) {
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
        <FilterRow
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
        <SortRow
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
