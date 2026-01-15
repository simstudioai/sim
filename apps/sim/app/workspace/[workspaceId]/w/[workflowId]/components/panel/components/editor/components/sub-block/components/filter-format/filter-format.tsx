'use client'

import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/emcn'
import { conditionsToJsonString, jsonStringToConditions } from '@/lib/table/filters/builder-utils'
import type { FilterCondition } from '@/lib/table/filters/constants'
import { useFilterBuilder } from '@/lib/table/filters/use-builder'
import { useBuilderJsonSync, useTableColumns } from '@/lib/table/hooks'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { EmptyState } from './components/empty-state'
import { FilterConditionRow } from './components/filter-condition-row'

interface FilterFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FilterCondition[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
  modeSubBlockId?: string
  jsonSubBlockId?: string
}

/**
 * Visual builder for filter conditions with optional JSON sync.
 *
 * When `modeSubBlockId` and `jsonSubBlockId` are provided, handles bidirectional
 * conversion between builder conditions and JSON format.
 */
export function FilterFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
  modeSubBlockId,
  jsonSubBlockId,
}: FilterFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<FilterCondition[]>(blockId, subBlockId)
  const [tableIdValue] = useSubBlockValue<string>(blockId, tableIdSubBlockId)
  const [modeValue] = useSubBlockValue<string>(blockId, modeSubBlockId || '_unused_mode')
  const [jsonValue, setJsonValue] = useSubBlockValue<string>(
    blockId,
    jsonSubBlockId || '_unused_json'
  )

  const dynamicColumns = useTableColumns({ tableId: tableIdValue })
  const columns = useMemo(() => {
    if (propColumns && propColumns.length > 0) return propColumns
    return dynamicColumns
  }, [propColumns, dynamicColumns])

  const value = isPreview ? previewValue : storeValue
  const conditions: FilterCondition[] = Array.isArray(value) && value.length > 0 ? value : []
  const isReadOnly = isPreview || disabled

  useBuilderJsonSync({
    modeValue,
    jsonValue,
    setJsonValue,
    isPreview,
    conditions,
    setConditions: setStoreValue,
    jsonToConditions: jsonStringToConditions,
    conditionsToJson: conditionsToJsonString,
    enabled: Boolean(modeSubBlockId && jsonSubBlockId),
  })

  const { comparisonOptions, logicalOptions, addCondition, removeCondition, updateCondition } =
    useFilterBuilder({
      columns,
      conditions,
      setConditions: setStoreValue,
      isReadOnly,
    })

  return (
    <div className='flex flex-col gap-[8px]'>
      {conditions.length === 0 ? (
        <EmptyState onAdd={addCondition} disabled={isReadOnly} label='Add filter condition' />
      ) : (
        <>
          {conditions.map((condition, index) => (
            <FilterConditionRow
              key={condition.id}
              blockId={blockId}
              subBlockId={subBlockId}
              condition={condition}
              index={index}
              columns={columns}
              comparisonOptions={comparisonOptions}
              logicalOptions={logicalOptions}
              isReadOnly={isReadOnly}
              isPreview={isPreview}
              disabled={disabled}
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
            Add condition
          </Button>
        </>
      )}
    </div>
  )
}
