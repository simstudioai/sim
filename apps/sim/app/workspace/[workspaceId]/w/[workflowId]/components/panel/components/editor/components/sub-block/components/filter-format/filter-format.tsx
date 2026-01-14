'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Combobox, type ComboboxOption, Input } from '@/components/emcn'
import {
  COMPARISON_OPERATORS,
  type FilterCondition,
  generateFilterId,
  LOGICAL_OPERATORS,
} from '@/lib/table/filter-builder-utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface FilterFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FilterCondition[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
}

/**
 * Creates a new filter condition with default values
 */
const createDefaultCondition = (columns: ComboboxOption[]): FilterCondition => ({
  id: generateFilterId(),
  logicalOperator: 'and',
  column: columns[0]?.value || '',
  operator: 'eq',
  value: '',
})

export function FilterFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
}: FilterFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<FilterCondition[]>(blockId, subBlockId)
  const [tableIdValue] = useSubBlockValue<string>(blockId, tableIdSubBlockId)
  const [dynamicColumns, setDynamicColumns] = useState<ComboboxOption[]>([])
  const fetchedTableIdRef = useRef<string | null>(null)

  // Fetch columns when tableId changes
  useEffect(() => {
    const fetchColumns = async () => {
      if (!tableIdValue || tableIdValue === fetchedTableIdRef.current) return

      try {
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')
        const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
        if (!workspaceId) return

        const response = await fetch(`/api/table/${tableIdValue}?workspaceId=${workspaceId}`)
        if (!response.ok) return

        const data = await response.json()
        const cols = data.table?.schema?.columns || []
        setDynamicColumns(
          cols.map((col: { name: string }) => ({ value: col.name, label: col.name }))
        )
        fetchedTableIdRef.current = tableIdValue
      } catch {
        // Ignore errors
      }
    }

    fetchColumns()
  }, [tableIdValue])

  const columns = useMemo(() => {
    if (propColumns && propColumns.length > 0) return propColumns
    return dynamicColumns
  }, [propColumns, dynamicColumns])

  const comparisonOptions = useMemo(
    () => COMPARISON_OPERATORS.map((op) => ({ value: op.value, label: op.label })),
    []
  )

  const logicalOptions = useMemo(
    () => LOGICAL_OPERATORS.map((op) => ({ value: op.value, label: op.label })),
    []
  )

  const value = isPreview ? previewValue : storeValue
  const conditions: FilterCondition[] = Array.isArray(value) && value.length > 0 ? value : []
  const isReadOnly = isPreview || disabled

  const addCondition = useCallback(() => {
    if (isReadOnly) return
    setStoreValue([...conditions, createDefaultCondition(columns)])
  }, [isReadOnly, conditions, columns, setStoreValue])

  const removeCondition = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setStoreValue(conditions.filter((c) => c.id !== id))
    },
    [isReadOnly, conditions, setStoreValue]
  )

  const updateCondition = useCallback(
    (id: string, field: keyof FilterCondition, newValue: string) => {
      if (isReadOnly) return
      setStoreValue(conditions.map((c) => (c.id === id ? { ...c, [field]: newValue } : c)))
    },
    [isReadOnly, conditions, setStoreValue]
  )

  return (
    <div className='flex flex-col gap-[8px]'>
      {conditions.length === 0 ? (
        <div className='flex items-center justify-center rounded-[4px] border border-dashed border-[var(--border-1)] py-[16px]'>
          <Button variant='ghost' size='sm' onClick={addCondition} disabled={isReadOnly}>
            <Plus className='mr-[4px] h-[12px] w-[12px]' />
            Add filter condition
          </Button>
        </div>
      ) : (
        <>
          {conditions.map((condition, index) => (
            <div key={condition.id} className='flex items-center gap-[6px]'>
              {/* Remove Button */}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => removeCondition(condition.id)}
                disabled={isReadOnly}
                className='h-[24px] w-[24px] shrink-0 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              >
                <X className='h-[12px] w-[12px]' />
              </Button>

              {/* Logical Operator */}
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
                    onChange={(v) =>
                      updateCondition(condition.id, 'logicalOperator', v as 'and' | 'or')
                    }
                    disabled={isReadOnly}
                  />
                )}
              </div>

              {/* Column Selector */}
              <div className='w-[100px] shrink-0'>
                <Combobox
                  size='sm'
                  options={columns}
                  value={condition.column}
                  onChange={(v) => updateCondition(condition.id, 'column', v)}
                  placeholder='Column'
                  disabled={isReadOnly}
                />
              </div>

              {/* Comparison Operator */}
              <div className='w-[110px] shrink-0'>
                <Combobox
                  size='sm'
                  options={comparisonOptions}
                  value={condition.operator}
                  onChange={(v) => updateCondition(condition.id, 'operator', v)}
                  disabled={isReadOnly}
                />
              </div>

              {/* Value Input */}
              <Input
                className='h-[28px] min-w-[80px] flex-1 text-[12px]'
                value={condition.value}
                onChange={(e) => updateCondition(condition.id, 'value', e.target.value)}
                placeholder='Value'
                disabled={isReadOnly}
              />
            </div>
          ))}

          {/* Add Button */}
          <Button
            variant='ghost'
            size='sm'
            onClick={addCondition}
            disabled={isReadOnly}
            className='self-start'
          >
            <Plus className='mr-[4px] h-[12px] w-[12px]' />
            Add condition
          </Button>
        </>
      )}
    </div>
  )
}
