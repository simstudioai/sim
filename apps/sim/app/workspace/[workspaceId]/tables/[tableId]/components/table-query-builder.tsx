'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Plus, X } from 'lucide-react'
import { Button, Combobox, Input } from '@/components/emcn'
import type { FilterCondition } from '@/lib/table/filters/constants'
import { useFilterBuilder } from '@/lib/table/filters/use-builder'

/**
 * Represents a sort configuration.
 */
export interface SortConfig {
  /** Column to sort by */
  column: string
  /** Sort direction */
  direction: 'asc' | 'desc'
}

/**
 * Filter value structure for API queries.
 */
type FilterValue = string | number | boolean | null | FilterValue[] | { [key: string]: FilterValue }

/**
 * Query options for the table API.
 */
export interface QueryOptions {
  /** Filter criteria or null for no filter, keys are column names, values are filter values */
  filter: Record<string, FilterValue> | null
  /** Sort configuration or null for default sort */
  sort: SortConfig | null
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
}

/**
 * Parses a string value into its appropriate type.
 *
 * @param value - String value to parse
 * @returns Parsed value (boolean, null, number, or string)
 */
function parseValue(value: string): string | number | boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (!Number.isNaN(Number(value)) && value !== '') return Number(value)
  return value
}

/**
 * Parses a comma-separated string into an array of values.
 *
 * @param value - Comma-separated string
 * @returns Array of parsed values
 */
function parseArrayValue(value: string): FilterValue[] {
  return value.split(',').map((v) => {
    const trimmed = v.trim()
    return parseValue(trimmed)
  })
}

/**
 * Converts builder filter conditions to a MongoDB-style filter object.
 *
 * Iterates through an array of filter conditions, combining them into a filter expression object
 * that is compatible with MongoDB's query format. Supports both "AND" and "OR" logical groupings:
 *
 * - "AND" conditions are grouped together in objects.
 * - "OR" conditions start new groups; groups are merged under a single `$or` array.
 *
 * @param conditions - The list of filter conditions specified by the user.
 * @returns A filter object to send to the API, or null if there are no conditions.
 *
 * @example
 * [
 *   { logicalOperator: 'and', column: 'age', operator: 'gt', value: '18' },
 *   { logicalOperator: 'or', column: 'role', operator: 'eq', value: 'admin' }
 * ]
 * // =>
 * {
 *   $or: [
 *     { age: { $gt: 18 } },
 *     { role: 'admin' }
 *   ]
 * }
 */
function conditionsToFilter(conditions: FilterCondition[]): Record<string, FilterValue> | null {
  // Return null if there are no filter conditions.
  if (conditions.length === 0) return null

  // Groups for $or logic; each group is an AND-combined object.
  const orGroups: Record<string, FilterValue>[] = []
  // Current group of AND'ed conditions.
  let currentAndGroup: Record<string, FilterValue> = {}

  conditions.forEach((condition, index) => {
    const { column, operator, value } = condition
    const operatorKey = `$${operator}`

    // Parse value as per operator: 'in' receives an array, others get a primitive value.
    let parsedValue: FilterValue = value
    if (operator === 'in') {
      parsedValue = parseArrayValue(value)
    } else {
      parsedValue = parseValue(value)
    }

    // For 'eq', value is direct (shorthand), otherwise use a key for the operator.
    const conditionObj: FilterValue =
      operator === 'eq' ? parsedValue : { [operatorKey]: parsedValue }

    // Group logic:
    // - First condition or 'and': add to the current AND group.
    // - 'or': finalize current AND group and start a new one.
    if (index === 0 || condition.logicalOperator === 'and') {
      currentAndGroup[column] = conditionObj
    } else if (condition.logicalOperator === 'or') {
      if (Object.keys(currentAndGroup).length > 0) {
        // Finalize and push the previous AND group to $or groups.
        orGroups.push({ ...currentAndGroup })
      }
      // Start a new AND group for subsequent conditions.
      currentAndGroup = { [column]: conditionObj }
    }
  })

  // Push the last AND group, if any, to the orGroups list.
  if (Object.keys(currentAndGroup).length > 0) {
    orGroups.push(currentAndGroup)
  }

  // If multiple groups exist, return as a $or query; otherwise, return the single group.
  if (orGroups.length > 1) {
    return { $or: orGroups }
  }

  return orGroups[0] || null
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
export function TableQueryBuilder({ columns, onApply, onAddRow }: TableQueryBuilderProps) {
  const [conditions, setConditions] = useState<FilterCondition[]>([])
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)

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
   * Adds a sort configuration.
   */
  const handleAddSort = useCallback(() => {
    setSortConfig({
      column: columns[0]?.name || '',
      direction: 'asc',
    })
  }, [columns])

  /**
   * Removes the sort configuration.
   */
  const handleRemoveSort = useCallback(() => {
    setSortConfig(null)
  }, [])

  /**
   * Applies the current filter and sort configuration.
   */
  const handleApply = useCallback(() => {
    const filter = conditionsToFilter(conditions)
    onApply({
      filter,
      sort: sortConfig,
    })
  }, [conditions, sortConfig, onApply])

  /**
   * Clears all filters and sort configuration.
   */
  const handleClear = useCallback(() => {
    setConditions([])
    setSortConfig(null)
    onApply({
      filter: null,
      sort: null,
    })
  }, [onApply])

  const hasChanges = conditions.length > 0 || sortConfig !== null

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
      {sortConfig && (
        <SortConfigRow
          sortConfig={sortConfig}
          columnOptions={columnOptions}
          sortDirectionOptions={sortDirectionOptions}
          onChange={setSortConfig}
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

        {!sortConfig && (
          <Button variant='default' size='sm' onClick={handleAddSort}>
            <ArrowUpAZ className='mr-[4px] h-[12px] w-[12px]' />
            Add sort
          </Button>
        )}

        {hasChanges && (
          <>
            <Button variant='default' size='sm' onClick={handleApply}>
              Apply
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
 * Props for the SortConfigRow component.
 */
interface SortConfigRowProps {
  /** The sort configuration */
  sortConfig: SortConfig
  /** Available column options */
  columnOptions: Array<{ value: string; label: string }>
  /** Available sort direction options */
  sortDirectionOptions: Array<{ value: string; label: string }>
  /** Callback to update the sort configuration */
  onChange: (config: SortConfig | null) => void
  /** Callback to remove the sort */
  onRemove: () => void
}

/**
 * Sort configuration row component.
 */
function SortConfigRow({
  sortConfig,
  columnOptions,
  sortDirectionOptions,
  onChange,
  onRemove,
}: SortConfigRowProps) {
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
          value={sortConfig.column}
          onChange={(value) => onChange({ ...sortConfig, column: value })}
          placeholder='Column'
        />
      </div>

      <div className='w-[130px] shrink-0'>
        <Combobox
          size='sm'
          options={sortDirectionOptions}
          value={sortConfig.direction}
          onChange={(value) => onChange({ ...sortConfig, direction: value as 'asc' | 'desc' })}
        />
      </div>

      <div className='flex items-center text-[12px] text-[var(--text-tertiary)]'>
        {sortConfig.direction === 'asc' ? (
          <ArrowUpAZ className='h-[14px] w-[14px]' />
        ) : (
          <ArrowDownAZ className='h-[14px] w-[14px]' />
        )}
      </div>
    </div>
  )
}
