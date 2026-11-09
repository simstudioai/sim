'use client'

import { useId } from 'react'
import { IconButton } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { RuleCard } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import { formatDisplayText } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import {
  getActiveWorkflowSearchHighlight,
  getWorkflowSearchLabelHighlight,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { ReferenceField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import type {
  ActiveSearchTarget,
  UseSubBlockInputResult,
} from '@/platform/lib/data/workflow-editor'
import type { ColumnOption, FilterRule } from '@/platform/lib/data/workflow-editor/builders'

const EMPTY_FIELD = {}

/** Props for {@link FilterRuleRow}. */
interface FilterRuleRowProps {
  blockId: string
  subBlockId: string
  rule: FilterRule
  index: number
  columns: ColumnOption[]
  comparisonOptions: ColumnOption[]
  logicalOptions: ColumnOption[]
  readOnly: boolean
  controller: UseSubBlockInputResult
  accessiblePrefixes: Set<string> | undefined
  activeSearchTarget: ActiveSearchTarget | null
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onToggleCollapse: (id: string) => void
}

const labelFor = (options: ColumnOption[], value: string) =>
  options.find((option) => option.value === value)?.label || value

/**
 * One filter condition: how it joins the previous one, the column, the comparison and a
 * reference-aware value. Collapsed, its header summarizes the column and comparison.
 */
export function FilterRuleRow({
  blockId,
  subBlockId,
  rule,
  index,
  columns,
  comparisonOptions,
  logicalOptions,
  readOnly,
  controller,
  accessiblePrefixes,
  activeSearchTarget,
  onAdd,
  onRemove,
  onUpdate,
  onToggleCollapse,
}: FilterRuleRowProps) {
  const valueId = useId()
  const name = `Condition ${index + 1}`
  const columnLabel = labelFor(columns, rule.column)
  const operatorLabel = labelFor(comparisonOptions, rule.operator)
  const labelHighlight = (field: 'column' | 'operator', label: string) =>
    getWorkflowSearchLabelHighlight({
      activeSearchTarget,
      blockId,
      subBlockId,
      valuePath: [index, field],
      label,
    })
  const summarized = Boolean(rule.collapsed && rule.column)

  return (
    <RuleCard
      label={name}
      title={
        summarized
          ? formatDisplayText(columnLabel, {
              workflowSearchHighlight: labelHighlight('column', columnLabel),
            })
          : name
      }
      detail={
        summarized
          ? formatDisplayText(operatorLabel, {
              workflowSearchHighlight: labelHighlight('operator', operatorLabel),
            })
          : undefined
      }
      collapsed={rule.collapsed}
      onToggle={readOnly ? undefined : () => onToggleCollapse(rule.id)}
      actions={
        readOnly ? undefined : (
          <>
            <IconButton label='Add condition' icon='I074' size='compact' tooltip onClick={onAdd} />
            <IconButton
              label={`Delete ${name.toLowerCase()}`}
              icon='I105'
              size='compact'
              tooltip
              onClick={() => onRemove(rule.id)}
            />
          </>
        )
      }
    >
      {index > 0 && (
        <Select
          label='Logic'
          field={EMPTY_FIELD}
          options={logicalOptions}
          value={rule.logicalOperator}
          onValueChange={(next) => onUpdate(rule.id, 'logicalOperator', next)}
          disabled={readOnly}
        />
      )}
      <SearchableSelect
        label='Column'
        options={columns}
        value={rule.column || null}
        selectedLabel={rule.column ? columnLabel : undefined}
        placeholder='Select column'
        searchLabel='Search columns'
        onValueChange={(next) => {
          if (next !== null) onUpdate(rule.id, 'column', next)
        }}
        disabled={readOnly}
      />
      <Select
        label='Operator'
        field={EMPTY_FIELD}
        options={comparisonOptions}
        value={rule.operator}
        onValueChange={(next) => onUpdate(rule.id, 'operator', next)}
        disabled={readOnly}
      />
      <FieldFrame id={valueId} label='Value'>
        <ReferenceField
          controller={controller}
          fieldKey={`filter-${rule.id}-value`}
          blockId={blockId}
          id={valueId}
          label={`${name} value`}
          placeholder='Enter value'
          value={rule.value}
          onChange={(next) => onUpdate(rule.id, 'value', next)}
          disabled={readOnly}
          accessiblePrefixes={accessiblePrefixes}
          searchHighlight={getActiveWorkflowSearchHighlight({
            activeSearchTarget,
            blockId,
            subBlockId,
            valuePath: [index, 'value'],
          })}
        />
      </FieldFrame>
    </RuleCard>
  )
}
