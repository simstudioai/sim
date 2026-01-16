'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Loader2, Plus, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button, Combobox, Input } from '@/components/emcn'
import type { FilterCondition, SortCondition } from '@/lib/table/filters/constants'
import { useFilterBuilder } from '@/lib/table/filters/use-builder'
import { conditionsToFilter } from '@/lib/table/filters/utils'
import type { JsonValue } from '@/lib/table/types'

/**
 * Query options for the table API.
 */
export interface QueryOptions {
  /** Filter criteria or null for no filter, keys are column names, values are filter values */
  filter: Record<string, JsonValue> | null
  /** Sort configuration or null for default sort */
  sort: SortCondition | null
}

/**
 * Column definition for filter building.
 */
interface Column {
  /** Column name */
  name: string
  /** Column data type */
  type: 'string' | 'number' | 'boolean' | 'json' | 'date'
}

/**
 * Props for the TableQueryBuilder component.
 */
interface TableQueryBuilderProps {
  /** Available columns for filtering */
  columns: Column[]
  /** Callback when query options should be applied */
  onApply: (options: QueryOptions) => void
  /** Callback to add a new row */
  onAddRow: () => void
  /** Whether a query is currently loading */
  isLoading?: boolean
}

/**
 * Component for building filter and sort queries for table data.
 *
 * @remarks
 * Provides a visual interface for:
 * - Adding multiple filter conditions with AND/OR logic
 * - Configuring sort column and direction
 * - Applying or clearing the query
 *
 * @example
 * ```tsx
 * <TableQueryBuilder
 *   columns={tableColumns}
 *   onApply={(options) => setQueryOptions(options)}
 *   onAddRow={() => setShowAddModal(true)}
 * />
 * ```
 */
export function TableQueryBuilder({
  columns,
  onApply,
  onAddRow,
  isLoading = false,
}: TableQueryBuilderProps) {
  const [conditions, setConditions] = useState<FilterCondition[]>([])
  const [sortCondition, setSortCondition] = useState<SortCondition | null>(null)

  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: col.name, label: col.name })),
    [columns]
  )

  // Use the shared filter builder hook
  const {
    comparisonOptions,
    logicalOptions,
    sortDirectionOptions,
    addCondition: handleAddCondition,
    removeCondition: handleRemoveCondition,
    updateCondition: handleUpdateCondition,
  } = useFilterBuilder({
    columns: columnOptions,
    conditions,
    setConditions,
  })

  /**
   * Adds a sort condition.
   */
  const handleAddSort = useCallback(() => {
    setSortCondition({
      id: nanoid(),
      column: columns[0]?.name || '',
      direction: 'asc',
    })
  }, [columns])

  /**
   * Removes the sort condition.
   */
  const handleRemoveSort = useCallback(() => {
    setSortCondition(null)
  }, [])

  /**
   * Applies the current filter and sort conditions.
   */
  const handleApply = useCallback(() => {
    const filter = conditionsToFilter(conditions)
    onApply({
      filter,
      sort: sortCondition,
    })
  }, [conditions, sortCondition, onApply])

  /**
   * Clears all filters and sort conditions.
   */
  const handleClear = useCallback(() => {
    setConditions([])
    setSortCondition(null)
    onApply({
      filter: null,
      sort: null,
    })
  }, [onApply])

  const hasChanges = conditions.length > 0 || sortCondition !== null

  return (
    <div className='flex flex-col gap-[8px]'>
      {/* Filter Conditions */}
      {conditions.map((condition, index) => (
        <FilterConditionRow
          key={condition.id}
          condition={condition}
          index={index}
          columnOptions={columnOptions}
          comparisonOptions={comparisonOptions}
          logicalOptions={logicalOptions}
          onUpdate={handleUpdateCondition}
          onRemove={handleRemoveCondition}
          onApply={handleApply}
        />
      ))}

      {/* Sort Row */}
      {sortCondition && (
        <SortConditionRow
          sortCondition={sortCondition}
          columnOptions={columnOptions}
          sortDirectionOptions={sortDirectionOptions}
          onChange={setSortCondition}
          onRemove={handleRemoveSort}
        />
      )}

      {/* Action Buttons */}
      <div className='flex items-center gap-[8px]'>
        <Button variant='default' size='sm' onClick={onAddRow}>
          <Plus className='mr-[4px] h-[12px] w-[12px]' />
          Add row
        </Button>

        <Button variant='default' size='sm' onClick={handleAddCondition}>
          <Plus className='mr-[4px] h-[12px] w-[12px]' />
          Add filter
        </Button>

        {!sortCondition && (
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

/**
 * Props for the FilterConditionRow component.
 */
interface FilterConditionRowProps {
  /** The filter condition */
  condition: FilterCondition
  /** Index in the conditions array */
  index: number
  /** Available column options */
  columnOptions: Array<{ value: string; label: string }>
  /** Available comparison operator options */
  comparisonOptions: Array<{ value: string; label: string }>
  /** Available logical operator options */
  logicalOptions: Array<{ value: string; label: string }>
  /** Callback to update a condition field */
  onUpdate: (id: string, field: keyof FilterCondition, value: string) => void
  /** Callback to remove the condition */
  onRemove: (id: string) => void
  /** Callback to apply filters */
  onApply: () => void
}

/**
 * A single filter condition row.
 */
function FilterConditionRow({
  condition,
  index,
  columnOptions,
  comparisonOptions,
  logicalOptions,
  onUpdate,
  onRemove,
  onApply,
}: FilterConditionRowProps) {
  return (
    <div className='flex items-center gap-[8px]'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onRemove(condition.id)}
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
            value={condition.logicalOperator}
            onChange={(value) => onUpdate(condition.id, 'logicalOperator', value as 'and' | 'or')}
          />
        )}
      </div>

      <div className='w-[140px] shrink-0'>
        <Combobox
          size='sm'
          options={columnOptions}
          value={condition.column}
          onChange={(value) => onUpdate(condition.id, 'column', value)}
          placeholder='Column'
        />
      </div>

      <div className='w-[130px] shrink-0'>
        <Combobox
          size='sm'
          options={comparisonOptions}
          value={condition.operator}
          onChange={(value) => onUpdate(condition.id, 'operator', value)}
        />
      </div>

      <Input
        className='h-[28px] min-w-[200px] flex-1 text-[12px]'
        value={condition.value}
        onChange={(e) => onUpdate(condition.id, 'value', e.target.value)}
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

/**
 * Props for the SortConditionRow component.
 */
interface SortConditionRowProps {
  /** The sort condition */
  sortCondition: SortCondition
  /** Available column options */
  columnOptions: Array<{ value: string; label: string }>
  /** Available sort direction options */
  sortDirectionOptions: Array<{ value: string; label: string }>
  /** Callback to update the sort condition */
  onChange: (condition: SortCondition | null) => void
  /** Callback to remove the sort */
  onRemove: () => void
}

/**
 * Sort condition row component.
 */
function SortConditionRow({
  sortCondition,
  columnOptions,
  sortDirectionOptions,
  onChange,
  onRemove,
}: SortConditionRowProps) {
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
          value={sortCondition.column}
          onChange={(value) => onChange({ ...sortCondition, column: value })}
          placeholder='Column'
        />
      </div>

      <div className='w-[130px] shrink-0'>
        <Combobox
          size='sm'
          options={sortDirectionOptions}
          value={sortCondition.direction}
          onChange={(value) => onChange({ ...sortCondition, direction: value as 'asc' | 'desc' })}
        />
      </div>

      <div className='flex items-center text-[12px] text-[var(--text-tertiary)]'>
        {sortCondition.direction === 'asc' ? (
          <ArrowUpAZ className='h-[14px] w-[14px]' />
        ) : (
          <ArrowDownAZ className='h-[14px] w-[14px]' />
        )}
      </div>
    </div>
  )
}
