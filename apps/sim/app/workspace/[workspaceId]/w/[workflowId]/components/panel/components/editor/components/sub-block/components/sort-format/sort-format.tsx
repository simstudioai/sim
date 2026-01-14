'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Combobox, type ComboboxOption } from '@/components/emcn'
import {
  generateSortId,
  SORT_DIRECTIONS,
  type SortCondition,
} from '@/lib/table/filter-builder-utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface SortFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: SortCondition[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
}

/**
 * Creates a new sort condition with default values
 */
const createDefaultCondition = (columns: ComboboxOption[]): SortCondition => ({
  id: generateSortId(),
  column: columns[0]?.value || '',
  direction: 'asc',
})

export function SortFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
}: SortFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<SortCondition[]>(blockId, subBlockId)
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
        // Add built-in columns for sorting
        const builtInCols = [
          { value: 'createdAt', label: 'createdAt' },
          { value: 'updatedAt', label: 'updatedAt' },
        ]
        const schemaCols = cols.map((col: { name: string }) => ({
          value: col.name,
          label: col.name,
        }))
        setDynamicColumns([...schemaCols, ...builtInCols])
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

  const directionOptions = useMemo(
    () => SORT_DIRECTIONS.map((dir) => ({ value: dir.value, label: dir.label })),
    []
  )

  const value = isPreview ? previewValue : storeValue
  const conditions: SortCondition[] = Array.isArray(value) && value.length > 0 ? value : []
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
    (id: string, field: keyof SortCondition, newValue: string) => {
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
            Add sort condition
          </Button>
        </div>
      ) : (
        <>
          {conditions.map((condition, index) => (
            <div
              key={condition.id}
              className='flex items-center gap-[6px] rounded-[4px] border border-[var(--border-1)] p-[8px]'
            >
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

              {/* Order indicator */}
              <div className='w-[90px] shrink-0'>
                <Combobox
                  size='sm'
                  options={[
                    { value: String(index + 1), label: index === 0 ? 'order by' : `then by` },
                  ]}
                  value={String(index + 1)}
                  disabled
                />
              </div>

              {/* Column Selector */}
              <div className='min-w-[120px] flex-1'>
                <Combobox
                  size='sm'
                  options={columns}
                  value={condition.column}
                  onChange={(v) => updateCondition(condition.id, 'column', v)}
                  placeholder='Column'
                  disabled={isReadOnly}
                />
              </div>

              {/* Direction Selector */}
              <div className='w-[110px] shrink-0'>
                <Combobox
                  size='sm'
                  options={directionOptions}
                  value={condition.direction}
                  onChange={(v) => updateCondition(condition.id, 'direction', v as 'asc' | 'desc')}
                  disabled={isReadOnly}
                />
              </div>
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
            Add sort
          </Button>
        </>
      )}
    </div>
  )
}
