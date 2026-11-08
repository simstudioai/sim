'use client'

import { Button } from '@sim/emcn/button'
import { toArray } from '@sim/utils/object'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { FilterRuleRow } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/filter-rule-row'
import { RuleList } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import {
  useAccessibleReferencePrefixes,
  useCanonicalSubBlockValue,
  useSubBlockInput,
  useSubBlockValue,
} from '@/platform/lib/data/workflow-editor'
import {
  type FilterRule,
  useFilterBuilder,
  useTableColumns,
} from '@/platform/lib/data/workflow-editor/builders'

interface FilterBuilderProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

/**
 * The table query filter of a table block: an ordered list of conditions on the selected table's
 * columns, each joined to the previous one by `and` or `or`, with reference-aware values.
 */
export function FilterBuilder({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: FilterBuilderProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<FilterRule[]>(blockId, subBlockId)
  const tableId = useCanonicalSubBlockValue<string>(blockId, 'tableId')
  const columns = useTableColumns({ tableId })
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const rules = toArray<FilterRule>(isPreview ? previewValue : storeValue)
  const readOnly = isPreview || disabled

  const { comparisonOptions, logicalOptions, addRule, removeRule, updateRule } = useFilterBuilder({
    columns,
    rules,
    setRules: setStoreValue,
    isReadOnly: readOnly,
  })

  const controller = useSubBlockInput({
    blockId,
    subBlockId,
    config: { id: subBlockId, type: 'filter-builder', connectionDroppable: true },
    isPreview,
    disabled,
  })

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
            Add filter condition
          </Button>
        }
      />
    )
  }

  return (
    <RuleList>
      {rules.map((rule, index) => {
        // A workflow-search match inside a collapsed condition opens it, so the match is visible.
        const searchOpened =
          activeSearchTarget?.subBlockId === subBlockId && activeSearchTarget.valuePath[0] === index
        return (
          <FilterRuleRow
            key={rule.id}
            blockId={blockId}
            subBlockId={subBlockId}
            rule={searchOpened ? { ...rule, collapsed: false } : rule}
            index={index}
            columns={columns}
            comparisonOptions={comparisonOptions}
            logicalOptions={logicalOptions}
            readOnly={readOnly}
            controller={controller}
            accessiblePrefixes={accessiblePrefixes}
            activeSearchTarget={activeSearchTarget}
            onAdd={addRule}
            onRemove={removeRule}
            onUpdate={updateRule}
            onToggleCollapse={toggleCollapse}
          />
        )
      })}
    </RuleList>
  )
}
