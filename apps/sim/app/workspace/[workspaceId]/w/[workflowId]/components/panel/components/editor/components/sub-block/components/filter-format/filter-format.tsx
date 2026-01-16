'use client'

import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/emcn'
import type { FilterRule } from '@/lib/table/filters/constants'
import { useFilterBuilder } from '@/lib/table/filters/use-builder'
import { useTableColumns } from '@/lib/table/hooks'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { EmptyState } from './components/empty-state'
import { FilterRuleRow } from './components/filter-rule-row'

interface FilterFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FilterRule[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
}

/** Visual builder for table filter rules in workflow blocks. */
export function FilterFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
}: FilterFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<FilterRule[]>(blockId, subBlockId)
  const [tableIdValue] = useSubBlockValue<string>(blockId, tableIdSubBlockId)

  const dynamicColumns = useTableColumns({ tableId: tableIdValue })
  const columns = useMemo(() => {
    if (propColumns && propColumns.length > 0) return propColumns
    return dynamicColumns
  }, [propColumns, dynamicColumns])

  const value = isPreview ? previewValue : storeValue
  const rules: FilterRule[] = Array.isArray(value) && value.length > 0 ? value : []
  const isReadOnly = isPreview || disabled

  const { comparisonOptions, logicalOptions, addRule, removeRule, updateRule } = useFilterBuilder({
    columns,
    rules,
    setRules: setStoreValue,
    isReadOnly,
  })

  return (
    <div className='flex flex-col gap-[8px]'>
      {rules.length === 0 ? (
        <EmptyState onAdd={addRule} disabled={isReadOnly} label='Add filter rule' />
      ) : (
        <>
          {rules.map((rule, index) => (
            <FilterRuleRow
              key={rule.id}
              blockId={blockId}
              subBlockId={subBlockId}
              rule={rule}
              index={index}
              columns={columns}
              comparisonOptions={comparisonOptions}
              logicalOptions={logicalOptions}
              isReadOnly={isReadOnly}
              isPreview={isPreview}
              disabled={disabled}
              onRemove={removeRule}
              onUpdate={updateRule}
            />
          ))}
          <Button
            variant='ghost'
            size='sm'
            onClick={addRule}
            disabled={isReadOnly}
            className='self-start'
          >
            <Plus className='mr-[4px] h-[12px] w-[12px]' />
            Add rule
          </Button>
        </>
      )}
    </div>
  )
}
