'use client'

import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { columnTypeOptionsForTable } from '@/app/(product)/workspace/[workspaceId]/tables/[tableId]/_components/column-types/column-types'
import { type ColumnDefinition, LOCK_TOOLTIPS } from '@/platform/lib/data/tables'

interface ColumnDropdownProps {
  columns: readonly ColumnDefinition[]
  disabled?: boolean
  /** A schema lock disables the action and explains why on hover or focus. */
  blocked: boolean
  onPickType: (type: ColumnDefinition['type']) => void
  onPickWorkflow: () => void
  onPickEnrichment: () => void
}

/**
 * New column: the single entry point for creating a column, in the control bar and after the last
 * header. Lists every column type, then Workflow and Enrichments; picking one opens its panel.
 */
export function ColumnDropdown({
  columns,
  disabled,
  blocked,
  onPickType,
  onPickWorkflow,
  onPickEnrichment,
}: ColumnDropdownProps) {
  const actions = (): MenuAction[] => [
    ...columnTypeOptionsForTable(columns, undefined).map((option) => ({
      id: option.type,
      label: option.label,
      icon: option.icon,
      disabled: Boolean(option.disabledReason),
      disabledReason: option.disabledReason,
      onSelect:
        option.type === 'workflow'
          ? onPickWorkflow
          : () => onPickType(option.type as ColumnDefinition['type']),
    })),
    { id: 'enrichments', label: 'Enrichments', icon: 'sparkles', onSelect: onPickEnrichment },
  ]
  return (
    <ActionMenu
      label='New column'
      triggerSize='compact'
      disabled={disabled || blocked}
      disabledReason={blocked ? LOCK_TOOLTIPS.schema : undefined}
      actions={actions}
    />
  )
}
