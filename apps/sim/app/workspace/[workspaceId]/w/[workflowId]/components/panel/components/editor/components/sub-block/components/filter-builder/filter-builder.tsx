'use client'

import { useCallback, useMemo } from 'react'
import type { ComboboxOption } from '@/components/emcn'
import { useTableColumns } from '@/lib/table/hooks'
import type { FilterRule } from '@/lib/table/query-builder/constants'
import { useFilterBuilder } from '@/lib/table/query-builder/use-query-builder'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { FilterRuleRow } from './components/filter-rule-row'

interface FilterBuilderProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FilterRule[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
}

const createDefaultRule = (columns: ComboboxOption[]): FilterRule => ({
  id: crypto.randomUUID(),
  logicalOperator: 'and',
  column: columns[0]?.value || '',
  operator: 'eq',
  value: '',
  collapsed: false,
})

/** Visual builder for table filter rules in workflow blocks. */
export function FilterBuilder({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
}: FilterBuilderProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<FilterRule[]>(blockId, subBlockId)
  const [tableIdValue] = useSubBlockValue<string>(blockId, tableIdSubBlockId)

  const dynamicColumns = useTableColumns({ tableId: tableIdValue })
  const columns = useMemo(() => {
    if (propColumns && propColumns.length > 0) return propColumns
    return dynamicColumns
  }, [propColumns, dynamicColumns])

  const value = isPreview ? previewValue : storeValue
  const rules: FilterRule[] =
    Array.isArray(value) && value.length > 0 ? value : [createDefaultRule(columns)]
  const isReadOnly = isPreview || disabled

  const { comparisonOptions, logicalOptions, addRule, removeRule, updateRule } = useFilterBuilder({
    columns,
    rules,
    setRules: setStoreValue,
    isReadOnly,
  })

  const inputController = useSubBlockInput({
    blockId,
    subBlockId,
    config: {
      id: subBlockId,
      type: 'filter-builder',
      connectionDroppable: true,
    },
    isPreview,
    disabled,
  })

  const toggleCollapse = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setStoreValue(rules.map((r) => (r.id === id ? { ...r, collapsed: !r.collapsed } : r)))
    },
    [isReadOnly, rules, setStoreValue]
  )

  const handleRemoveRule = useCallback(
    (id: string) => {
      if (isReadOnly) return
      if (rules.length === 1) {
        setStoreValue([createDefaultRule(columns)])
      } else {
        removeRule(id)
      }
    },
    [isReadOnly, rules, columns, setStoreValue, removeRule]
  )

  return (
    <div className='space-y-[8px]'>
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
          onAdd={addRule}
          onRemove={handleRemoveRule}
          onUpdate={updateRule}
          onToggleCollapse={toggleCollapse}
          inputController={inputController}
        />
      ))}
    </div>
  )
}
