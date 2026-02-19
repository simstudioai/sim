'use client'

import { useCallback, useMemo } from 'react'
import type { ComboboxOption } from '@/components/emcn'
import { useTableColumns } from '@/lib/table/hooks'
import { SORT_DIRECTIONS, type SortRule } from '@/lib/table/query-builder/constants'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
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
  id: crypto.randomUUID(),
  column: columns[0]?.value || '',
  direction: 'asc',
  collapsed: false,
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
  const rules: SortRule[] =
    Array.isArray(value) && value.length > 0 ? value : [createDefaultRule(columns)]
  const isReadOnly = isPreview || disabled

  const addRule = useCallback(() => {
    if (isReadOnly) return
    setStoreValue([...rules, createDefaultRule(columns)])
  }, [isReadOnly, rules, columns, setStoreValue])

  const removeRule = useCallback(
    (id: string) => {
      if (isReadOnly) return
      if (rules.length === 1) {
        setStoreValue([createDefaultRule(columns)])
      } else {
        setStoreValue(rules.filter((r) => r.id !== id))
      }
    },
    [isReadOnly, rules, columns, setStoreValue]
  )

  const updateRule = useCallback(
    (id: string, field: keyof SortRule, newValue: string) => {
      if (isReadOnly) return
      setStoreValue(rules.map((r) => (r.id === id ? { ...r, [field]: newValue } : r)))
    },
    [isReadOnly, rules, setStoreValue]
  )

  const toggleCollapse = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setStoreValue(rules.map((r) => (r.id === id ? { ...r, collapsed: !r.collapsed } : r)))
    },
    [isReadOnly, rules, setStoreValue]
  )

  return (
    <div className='space-y-[8px]'>
      {rules.map((rule, index) => (
        <SortRuleRow
          key={rule.id}
          rule={rule}
          index={index}
          columns={columns}
          directionOptions={directionOptions}
          isReadOnly={isReadOnly}
          onAdd={addRule}
          onRemove={removeRule}
          onUpdate={updateRule}
          onToggleCollapse={toggleCollapse}
        />
      ))}
    </div>
  )
}
