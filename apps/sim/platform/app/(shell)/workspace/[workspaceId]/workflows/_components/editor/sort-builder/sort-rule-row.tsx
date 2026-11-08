'use client'

import { IconButton } from '@sim/emcn/button'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { RuleCard } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/filter-builder/rule-card'
import { formatDisplayText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import type { ActiveSearchTarget } from '@/platform/lib/data/workflow-editor'
import {
  type ColumnOption,
  SORT_DIRECTION_OPTIONS,
  type SortRule,
} from '@/platform/lib/data/workflow-editor/builders'

const EMPTY_FIELD = {}

/** Props for {@link SortRuleRow}. */
interface SortRuleRowProps {
  blockId: string
  subBlockId: string
  rule: SortRule
  index: number
  columns: ColumnOption[]
  readOnly: boolean
  activeSearchTarget: ActiveSearchTarget | null
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof SortRule, value: string) => void
  onToggleCollapse: (id: string) => void
}

const labelFor = (options: readonly ColumnOption[], value: string) =>
  options.find((option) => option.value === value)?.label || value

/** One sort: a column and a direction. Collapsed, its header summarizes both. */
export function SortRuleRow({
  blockId,
  subBlockId,
  rule,
  index,
  columns,
  readOnly,
  activeSearchTarget,
  onAdd,
  onRemove,
  onUpdate,
  onToggleCollapse,
}: SortRuleRowProps) {
  const name = `Sort ${index + 1}`
  const columnLabel = labelFor(columns, rule.column)
  const directionLabel = labelFor(SORT_DIRECTION_OPTIONS, rule.direction)
  const labelHighlight = (field: 'column' | 'direction', label: string) =>
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
          ? formatDisplayText(directionLabel, {
              workflowSearchHighlight: labelHighlight('direction', directionLabel),
            })
          : undefined
      }
      collapsed={rule.collapsed}
      onToggle={readOnly ? undefined : () => onToggleCollapse(rule.id)}
      actions={
        readOnly ? undefined : (
          <>
            <IconButton label='Add sort' icon='I074' size='compact' tooltip onClick={onAdd} />
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
        label='Direction'
        field={EMPTY_FIELD}
        options={SORT_DIRECTION_OPTIONS}
        value={rule.direction}
        onValueChange={(next) => onUpdate(rule.id, 'direction', next)}
        disabled={readOnly}
      />
    </RuleCard>
  )
}
