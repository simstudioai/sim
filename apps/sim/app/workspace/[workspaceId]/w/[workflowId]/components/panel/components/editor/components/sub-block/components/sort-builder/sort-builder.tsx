'use client'

import { useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button, type ComboboxOption } from '@/components/emcn'
import { useTableColumns } from '@/lib/table/hooks'
import { SORT_DIRECTIONS, type SortRule } from '@/lib/table/query-builder/constants'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { EmptyState } from './components/empty-state'
import { SortRuleRow } from './components/sort-rule-row'

interface SortBuilderProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: SortRule[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
}

const createDefaultRule = (columns: ComboboxOption[]): SortRule => ({
  id: nanoid(),
  column: columns[0]?.value || '',
  direction: 'asc',
})

/** Visual builder for table sort rules in workflow blocks. */
export function SortBuilder({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
}: SortBuilderProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<SortRule[]>(blockId, subBlockId)
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
  const rules: SortRule[] = Array.isArray(value) && value.length > 0 ? value : []
  const isReadOnly = isPreview || disabled

  const addRule = useCallback(() => {
    if (isReadOnly) return
    setStoreValue([...rules, createDefaultRule(columns)])
  }, [isReadOnly, rules, columns, setStoreValue])

  const removeRule = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setStoreValue(rules.filter((r) => r.id !== id))
    },
    [isReadOnly, rules, setStoreValue]
  )

  const updateRule = useCallback(
    (id: string, field: keyof SortRule, newValue: string) => {
      if (isReadOnly) return
      setStoreValue(rules.map((r) => (r.id === id ? { ...r, [field]: newValue } : r)))
    },
    [isReadOnly, rules, setStoreValue]
  )

  return (
    <div className='flex flex-col gap-[8px]'>
      {rules.length === 0 ? (
        <EmptyState onAdd={addRule} disabled={isReadOnly} label='Add sort rule' />
      ) : (
        <>
          {rules.map((rule, index) => (
            <SortRuleRow
              key={rule.id}
              rule={rule}
              index={index}
              columns={columns}
              directionOptions={directionOptions}
              isReadOnly={isReadOnly}
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
            Add sort
          </Button>
        </>
      )}
    </div>
  )
}
