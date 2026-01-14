'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Plus, X } from 'lucide-react'
import { Button, Combobox, Input } from '@/components/emcn'

/**
 * Available comparison operators for filter conditions
 */
const COMPARISON_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equals' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'in array' },
] as const

/**
 * Logical operators for combining conditions (for subsequent filters)
 */
const LOGICAL_OPERATORS = [
  { value: 'and', label: 'and' },
  { value: 'or', label: 'or' },
] as const

/**
 * Sort direction options
 */
const SORT_DIRECTIONS = [
  { value: 'asc', label: 'ascending' },
  { value: 'desc', label: 'descending' },
] as const

/**
 * Represents a single filter condition
 */
export interface FilterCondition {
  id: string
  logicalOperator: 'and' | 'or'
  column: string
  operator: string
  value: string
}

/**
 * Represents a sort configuration
 */
export interface SortConfig {
  column: string
  direction: 'asc' | 'desc'
}

/**
 * Query options for the table
 */
export interface QueryOptions {
  filter: Record<string, any> | null
  sort: SortConfig | null
}

interface Column {
  name: string
  type: string
}

interface FilterBuilderProps {
  columns: Column[]
  onApply: (options: QueryOptions) => void
  onAddRow: () => void
}

/**
 * Generates a unique ID for filter conditions
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/**
 * Converts filter conditions to MongoDB-style filter object
 */
function conditionsToFilter(conditions: FilterCondition[]): Record<string, any> | null {
  if (conditions.length === 0) return null

  const orGroups: Record<string, any>[] = []
  let currentAndGroup: Record<string, any> = {}

  conditions.forEach((condition, index) => {
    const { column, operator, value } = condition
    const operatorKey = `$${operator}`

    let parsedValue: any = value
    if (value === 'true') parsedValue = true
    else if (value === 'false') parsedValue = false
    else if (value === 'null') parsedValue = null
    else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value)
    else if (operator === 'in') {
      parsedValue = value.split(',').map((v) => {
        const trimmed = v.trim()
        if (trimmed === 'true') return true
        if (trimmed === 'false') return false
        if (trimmed === 'null') return null
        if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed)
        return trimmed
      })
    }

    const conditionObj = operator === 'eq' ? parsedValue : { [operatorKey]: parsedValue }

    if (index === 0 || condition.logicalOperator === 'and') {
      currentAndGroup[column] = conditionObj
    } else if (condition.logicalOperator === 'or') {
      if (Object.keys(currentAndGroup).length > 0) {
        orGroups.push({ ...currentAndGroup })
      }
      currentAndGroup = { [column]: conditionObj }
    }
  })

  if (Object.keys(currentAndGroup).length > 0) {
    orGroups.push(currentAndGroup)
  }

  if (orGroups.length > 1) {
    return { $or: orGroups }
  }

  return orGroups[0] || null
}

export function FilterBuilder({ columns, onApply, onAddRow }: FilterBuilderProps) {
  const [conditions, setConditions] = useState<FilterCondition[]>([])
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)

  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: col.name, label: col.name })),
    [columns]
  )

  const comparisonOptions = useMemo(
    () => COMPARISON_OPERATORS.map((op) => ({ value: op.value, label: op.label })),
    []
  )

  const logicalOptions = useMemo(
    () => LOGICAL_OPERATORS.map((op) => ({ value: op.value, label: op.label })),
    []
  )

  const sortDirectionOptions = useMemo(
    () => SORT_DIRECTIONS.map((d) => ({ value: d.value, label: d.label })),
    []
  )

  const handleAddCondition = useCallback(() => {
    const newCondition: FilterCondition = {
      id: generateId(),
      logicalOperator: 'and',
      column: columns[0]?.name || '',
      operator: 'eq',
      value: '',
    }
    setConditions((prev) => [...prev, newCondition])
  }, [columns])

  const handleRemoveCondition = useCallback((id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const handleUpdateCondition = useCallback(
    (id: string, field: keyof FilterCondition, value: string) => {
      setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)))
    },
    []
  )

  const handleAddSort = useCallback(() => {
    setSortConfig({
      column: columns[0]?.name || '',
      direction: 'asc',
    })
  }, [columns])

  const handleRemoveSort = useCallback(() => {
    setSortConfig(null)
  }, [])

  const handleApply = useCallback(() => {
    const filter = conditionsToFilter(conditions)
    onApply({
      filter,
      sort: sortConfig,
    })
  }, [conditions, sortConfig, onApply])

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
        <div key={condition.id} className='flex items-center gap-[8px]'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => handleRemoveCondition(condition.id)}
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
                onChange={(value) =>
                  handleUpdateCondition(condition.id, 'logicalOperator', value as 'and' | 'or')
                }
              />
            )}
          </div>

          <div className='w-[140px] shrink-0'>
            <Combobox
              size='sm'
              options={columnOptions}
              value={condition.column}
              onChange={(value) => handleUpdateCondition(condition.id, 'column', value)}
              placeholder='Column'
            />
          </div>

          <div className='w-[130px] shrink-0'>
            <Combobox
              size='sm'
              options={comparisonOptions}
              value={condition.operator}
              onChange={(value) => handleUpdateCondition(condition.id, 'operator', value)}
            />
          </div>

          <Input
            className='h-[28px] min-w-[200px] flex-1 text-[12px]'
            value={condition.value}
            onChange={(e) => handleUpdateCondition(condition.id, 'value', e.target.value)}
            placeholder='Value'
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleApply()
              }
            }}
          />
        </div>
      ))}

      {/* Sort Row */}
      {sortConfig && (
        <div className='flex items-center gap-[8px]'>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleRemoveSort}
            className='h-[28px] w-[28px] shrink-0 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
          >
            <X className='h-[12px] w-[12px]' />
          </Button>

          <div className='w-[80px] shrink-0'>
            <Combobox
              size='sm'
              options={[{ value: 'order', label: 'order' }]}
              value='order'
              disabled
            />
          </div>

          <div className='w-[140px] shrink-0'>
            <Combobox
              size='sm'
              options={columnOptions}
              value={sortConfig.column}
              onChange={(value) =>
                setSortConfig((prev) => (prev ? { ...prev, column: value } : null))
              }
              placeholder='Column'
            />
          </div>

          <div className='w-[130px] shrink-0'>
            <Combobox
              size='sm'
              options={sortDirectionOptions}
              value={sortConfig.direction}
              onChange={(value) =>
                setSortConfig((prev) =>
                  prev ? { ...prev, direction: value as 'asc' | 'desc' } : null
                )
              }
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
