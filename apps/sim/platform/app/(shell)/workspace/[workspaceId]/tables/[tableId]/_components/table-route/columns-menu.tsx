'use client'

import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { type ColumnDefinition, getColumnId, type WorkflowGroup } from '@/platform/lib/data/tables'

interface ColumnsMenuProps {
  columns: ColumnDefinition[]
  workflowGroups: WorkflowGroup[]
  /** Column ids hidden from the grid. */
  hiddenColumns: string[]
  onChange: (hiddenColumns: string[]) => void
}

/**
 * Shows and hides grid columns. A workflow group's outputs follow its own toggle, which flips them
 * all at once; the group's spanning header is derived from the outputs still visible, so hiding them
 * all removes it. The menu stays open while columns are toggled.
 */
export function ColumnsMenu({
  columns,
  workflowGroups,
  hiddenColumns,
  onChange,
}: ColumnsMenuProps) {
  const hiddenCount = hiddenColumns.length

  const actions = (): MenuAction[] => {
    const hiddenSet = new Set(hiddenColumns)
    const plain: ColumnDefinition[] = []
    const byGroup = new Map<string, ColumnDefinition[]>()
    for (const col of columns) {
      if (!col.workflowGroupId) {
        plain.push(col)
        continue
      }
      const existing = byGroup.get(col.workflowGroupId)
      if (existing) existing.push(col)
      else byGroup.set(col.workflowGroupId, [col])
    }
    const groupById = new Map(workflowGroups.map((group) => [group.id, group]))

    /** Flips columns, refusing a change that would hide every column. */
    const toggle = (ids: string[], nextHidden: boolean) => {
      const next = new Set(hiddenColumns)
      for (const id of ids) {
        if (nextHidden) next.add(id)
        else next.delete(id)
      }
      if (next.size >= columns.length) return
      onChange([...next])
    }

    const rows: MenuAction[] = plain.map((col) => {
      const id = getColumnId(col)
      const visible = !hiddenSet.has(id)
      return {
        id,
        label: col.name,
        icon: visible ? 'eye' : 'eye-off',
        checked: visible,
        onSelect: () => toggle([id], visible),
      }
    })
    for (const [groupId, children] of byGroup) {
      const childIds = children.map(getColumnId)
      const visibleCount = childIds.filter((id) => !hiddenSet.has(id)).length
      // The group reads visible only when every output is, so one click reveals the rest of a
      // partly hidden group rather than hiding what still shows.
      const allVisible = visibleCount === childIds.length
      rows.push({
        id: `group:${groupId}`,
        label: groupById.get(groupId)?.name ?? 'Workflow',
        icon: visibleCount > 0 ? 'eye' : 'eye-off',
        detail:
          visibleCount > 0 && !allVisible ? `${visibleCount} of ${childIds.length}` : undefined,
        separatorBefore: rows.length > 0,
        checked: allVisible,
        onSelect: () => toggle(childIds, allVisible),
      })
      for (const col of children) {
        const id = getColumnId(col)
        const visible = !hiddenSet.has(id)
        rows.push({
          id,
          label: col.name,
          icon: visible ? 'eye' : 'eye-off',
          checked: visible,
          onSelect: () => toggle([id], visible),
        })
      }
    }
    return rows
  }

  return (
    <ActionMenu
      label='Columns'
      triggerSize='compact'
      triggerText={hiddenCount > 0 ? `Columns · ${hiddenCount} hidden` : 'Columns'}
      disabled={columns.length === 0}
      actions={actions}
    />
  )
}
