'use client'

import { useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button, type ComboboxOption } from '@/components/emcn'
import { SORT_DIRECTIONS, type SortCondition } from '@/lib/table/filters/constants'
import { useTableColumns } from '@/lib/table/hooks'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { EmptyState } from './components/empty-state'
import { SortConditionRow } from './components/sort-condition-row'

interface SortFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: SortCondition[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
}

const createDefaultCondition = (columns: ComboboxOption[]): SortCondition => ({
  id: nanoid(),
  column: columns[0]?.value || '',
  direction: 'asc',
})

/**
 * Visual builder for sort conditions.
 */
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

  const dynamicColumns = useTableColumns({ tableId: tableIdValue, includeBuiltIn: true })
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
        <EmptyState onAdd={addCondition} disabled={isReadOnly} label='Add sort condition' />
      ) : (
        <>
          {conditions.map((condition, index) => (
            <SortConditionRow
              key={condition.id}
              condition={condition}
              index={index}
              columns={columns}
              directionOptions={directionOptions}
              isReadOnly={isReadOnly}
              onRemove={removeCondition}
              onUpdate={updateCondition}
            />
          ))}
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
