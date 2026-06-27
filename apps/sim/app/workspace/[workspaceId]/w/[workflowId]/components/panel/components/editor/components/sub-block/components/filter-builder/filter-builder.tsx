'use client'

import { useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/emcn'
import { useTableColumns } from '@/lib/table/hooks'
import type { FilterRule } from '@/lib/table/query-builder/constants'
import { useFilterBuilder } from '@/lib/table/query-builder/use-query-builder'
import { useCanonicalSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-canonical-sub-block-value'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { FilterRuleRow } from './components/filter-rule-row'
import { useTranslations } from 'next-intl'

interface FilterBuilderProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FilterRule[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
}

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
  const t = useTranslations('auto')
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<FilterRule[]>(blockId, subBlockId)
  const tableIdValue = useCanonicalSubBlockValue<string>(blockId, tableIdSubBlockId)

  const dynamicColumns = useTableColumns({ tableId: tableIdValue })
  const columns = useMemo(() => {
    if (propColumns && propColumns.length > 0) return propColumns
    return dynamicColumns
  }, [propColumns, dynamicColumns])

  const value = isPreview ? previewValue : storeValue
  const rules: FilterRule[] = Array.isArray(value) ? value : []
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
      removeRule(id)
    },
    [isReadOnly, removeRule]
  )

  if (rules.length === 0) {
    if (isReadOnly) return null
    return (
      <Button
        variant='ghost'
        onClick={addRule}
        className='h-7 w-full justify-start gap-1.5 border border-[var(--border-1)] border-dashed text-[var(--text-muted)] text-small'
      >
        <Plus className='size-[14px]' />
        {t('add_filter_condition')}
      </Button>
    )
  }

  return (
    <div className='space-y-2'>
      {rules.map((rule, index) => {
        const isSearchExpanded =
          activeSearchTarget?.subBlockId === subBlockId && activeSearchTarget.valuePath[0] === index
        const displayRule = isSearchExpanded ? { ...rule, collapsed: false } : rule
        return (
          <FilterRuleRow
            key={rule.id}
            blockId={blockId}
            subBlockId={subBlockId}
            rule={displayRule}
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
        )
      })}
    </div>
  )
}
