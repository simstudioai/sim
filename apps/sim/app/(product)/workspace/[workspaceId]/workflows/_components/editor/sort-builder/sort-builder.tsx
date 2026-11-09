'use client'

import { Button } from '@sim/emcn/button'
import { generateId } from '@sim/utils/id'
import { toArray } from '@sim/utils/object'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { RuleList } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import { SortRuleRow } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/sort-builder/sort-rule-row'
import { useCanonicalSubBlockValue, useSubBlockValue } from '@/platform/lib/data/workflow-editor'
import {
  type ColumnOption,
  type SortRule,
  useTableColumns,
} from '@/platform/lib/data/workflow-editor/builders'

interface SortBuilderProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

const createDefaultRule = (columns: ColumnOption[]): SortRule => ({
  id: generateId(),
  column: columns[0]?.value || '',
  direction: 'asc',
  collapsed: false,
})

/**
 * The table query sort of a table block: an ordered list of column and direction pairs over the
 * selected table's columns and its built-in timestamps.
 */
export function SortBuilder({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: SortBuilderProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<SortRule[]>(blockId, subBlockId)
  const tableId = useCanonicalSubBlockValue<string>(blockId, 'tableId')
  const columns = useTableColumns({ tableId, includeBuiltIn: true })

  const rules = toArray<SortRule>(isPreview ? previewValue : storeValue)
  const readOnly = isPreview || disabled

  const addRule = () => {
    if (readOnly) return
    setStoreValue([...rules, createDefaultRule(columns)])
  }

  const removeRule = (id: string) => {
    if (readOnly) return
    setStoreValue(rules.filter((rule) => rule.id !== id))
  }

  const updateRule = (id: string, field: keyof SortRule, value: string) => {
    if (readOnly) return
    setStoreValue(rules.map((rule) => (rule.id === id ? { ...rule, [field]: value } : rule)))
  }

  const toggleCollapse = (id: string) => {
    if (readOnly) return
    setStoreValue(
      rules.map((rule) => (rule.id === id ? { ...rule, collapsed: !rule.collapsed } : rule))
    )
  }

  if (rules.length === 0) {
    if (readOnly) return null
    return (
      <RuleList
        action={
          <Button size='compact' icon='I074' onClick={addRule}>
            Add sort
          </Button>
        }
      />
    )
  }

  return (
    <RuleList>
      {rules.map((rule, index) => (
        <SortRuleRow
          key={rule.id}
          blockId={blockId}
          subBlockId={subBlockId}
          rule={rule}
          index={index}
          columns={columns}
          readOnly={readOnly}
          activeSearchTarget={activeSearchTarget}
          onAdd={addRule}
          onRemove={removeRule}
          onUpdate={updateRule}
          onToggleCollapse={toggleCollapse}
        />
      ))}
    </RuleList>
  )
}
