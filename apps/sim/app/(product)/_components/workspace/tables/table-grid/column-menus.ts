import type { MenuAction } from '@sim/emcn/menu/action-menu'
import type { SortDirection } from '@/platform/lib/data/tables'
import { LOCALE } from '@/platform/shared/time'

/** Row-cap presets for the "Run N empty rows" shortcuts, shared by both run menus. */
const LIMITED_RUN_PRESETS = [10, 1000] as const

/**
 * The table-scoped run items. With an active filter the run covers only matching rows, so the
 * labels say "filtered rows". Empty before all, matching the action bar and the row menu.
 */
function runMenuLabels(hasActiveFilter: boolean) {
  const rows = hasActiveFilter ? 'filtered rows' : 'rows'
  return {
    all: `Run all ${rows}`,
    incomplete: `Run empty ${rows}`,
    limited: (max: number) => `Run ${max.toLocaleString(LOCALE)} empty ${rows}`,
  }
}

interface RunMenuOptions {
  /** Rows in the current multi-row selection; a positive count adds "Run N selected rows". */
  selectedRowCount: number
  hasActiveFilter: boolean
  onRunSelected: () => void
  onRunIncomplete: () => void
  onRunLimited: (max: number) => void
  onRunAll: () => void
}

/** A workflow group's run choices: selected rows, empty rows, the first N empty rows, all rows. */
export function runMenuActions({
  selectedRowCount,
  hasActiveFilter,
  onRunSelected,
  onRunIncomplete,
  onRunLimited,
  onRunAll,
}: RunMenuOptions): [MenuAction, ...MenuAction[]] {
  const labels = runMenuLabels(hasActiveFilter)
  const incomplete: MenuAction = {
    id: 'run-incomplete',
    label: labels.incomplete,
    onSelect: onRunIncomplete,
  }
  const limited: MenuAction[] = LIMITED_RUN_PRESETS.map((max) => ({
    id: `run-${max}`,
    label: labels.limited(max),
    onSelect: () => onRunLimited(max),
  }))
  const all: MenuAction = { id: 'run-all', label: labels.all, onSelect: onRunAll }
  if (selectedRowCount === 0) return [incomplete, ...limited, all]
  const selected: MenuAction = {
    id: 'run-selected',
    label: `Run ${selectedRowCount} selected ${selectedRowCount === 1 ? 'row' : 'rows'}`,
    onSelect: onRunSelected,
  }
  return [selected, incomplete, ...limited, all]
}

interface ColumnOptionsOptions {
  columnKey: string
  /** "Hide column" for a workflow output whose group keeps other outputs, else "Delete column". */
  deleteLabel: 'Delete column' | 'Hide column'
  /** Why column changes are unavailable; disables the schema rows and explains them. */
  schemaLockedReason?: string
  /** Why deleting is unavailable; disables the destructive row. */
  deleteLockedReason?: string
  /** Group-level run choices, present when opened from a workflow group header. */
  run?: RunMenuOptions
  /** Omitted on a group header, which spans several columns and so has nothing single to sort by. */
  sort?: {
    direction?: SortDirection
    onSort: (columnKey: string, direction: SortDirection) => void
    onClear: () => void
  }
  onViewWorkflow?: () => void
  onEdit: () => void
  pin?: { pinned: boolean; onToggle: () => void }
  onInsertLeft: () => void
  onInsertRight: () => void
  onDelete: () => void
}

/**
 * The column menu, opened from a header's chevron or by right-clicking a header. Sort leads the
 * column-scoped block (the control bar reads Filter, Sort, Columns, and this menu has no filter);
 * a rule marks where it stops acting on the column and starts creating siblings, and another
 * before the destructive row.
 */
export function columnOptionActions({
  columnKey,
  deleteLabel,
  schemaLockedReason,
  deleteLockedReason,
  run,
  sort,
  onViewWorkflow,
  onEdit,
  pin,
  onInsertLeft,
  onInsertRight,
  onDelete,
}: ColumnOptionsOptions): MenuAction[] {
  // Hiding a workflow output leaves the data alone, so no lock covers it.
  const destructiveReason =
    deleteLabel === 'Hide column' ? undefined : (schemaLockedReason ?? deleteLockedReason)
  const actions: MenuAction[] = []
  if (run) actions.push({ id: 'run', label: 'Run', icon: 'play', children: runMenuActions(run) })
  if (sort) {
    if (sort.direction) {
      actions.push({ id: 'clear-sort', label: 'Clear sort', icon: 'I105', onSelect: sort.onClear })
    }
    actions.push(
      {
        id: 'sort-asc',
        label: 'Sort ascending',
        icon: 'I023',
        checked: sort.direction === 'asc',
        onSelect: () => sort.onSort(columnKey, 'asc'),
      },
      {
        id: 'sort-desc',
        label: 'Sort descending',
        icon: 'I102',
        checked: sort.direction === 'desc',
        onSelect: () => sort.onSort(columnKey, 'desc'),
      }
    )
  }
  if (onViewWorkflow) {
    actions.push({
      id: 'view-workflow',
      label: 'View workflow',
      icon: 'eye',
      onSelect: onViewWorkflow,
    })
  }
  actions.push({
    id: 'edit',
    label: 'Edit column',
    icon: 'I036',
    disabled: Boolean(schemaLockedReason),
    disabledReason: schemaLockedReason,
    onSelect: onEdit,
  })
  if (pin) {
    actions.push({
      id: 'pin',
      label: pin.pinned ? 'Unpin column' : 'Pin column',
      icon: 'I131',
      onSelect: pin.onToggle,
    })
  }
  actions.push(
    {
      id: 'insert-left',
      label: 'Insert column left',
      icon: 'I093',
      separatorBefore: true,
      disabled: Boolean(schemaLockedReason),
      disabledReason: schemaLockedReason,
      onSelect: onInsertLeft,
    },
    {
      id: 'insert-right',
      label: 'Insert column right',
      icon: 'arrow-right',
      disabled: Boolean(schemaLockedReason),
      disabledReason: schemaLockedReason,
      onSelect: onInsertRight,
    },
    {
      id: 'delete',
      label: deleteLabel,
      icon: deleteLabel === 'Hide column' ? 'eye-off' : 'trash',
      separatorBefore: true,
      destructive: deleteLabel === 'Delete column',
      disabled: Boolean(destructiveReason),
      disabledReason: destructiveReason,
      onSelect: onDelete,
    }
  )
  return actions
}

interface CellMenuOptions {
  selectedRowCount: number
  /** Opened on a workflow-output cell: Run and Re-run act on that cell's group only. */
  workflowCellScoped: boolean
  runningCount: number
  /** Hands the clicked rows, or the cell range under the pointer, to a new chat as a draft. */
  onAddToChat?: { cellScoped: boolean; rowCount: number; onSelect: () => void }
  onEditCell?: { disabled: boolean; onSelect: () => void }
  onFilterByCellValue?: () => void
  onRun?: () => void
  onRefresh?: () => void
  onStop?: () => void
  onViewExecution?: () => void
  insertDisabled: boolean
  duplicateDisabled: boolean
  deleteDisabled: boolean
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/**
 * The cell and row menu. Add to Chat leads; Run, Re-run, Stop and View execution follow the action bar's order; a
 * rule marks where it stops acting on the clicked cell or rows and starts creating siblings,
 * guarded on every conditional item above it, and another precedes Delete.
 */
export function cellMenuActions({
  selectedRowCount,
  workflowCellScoped,
  runningCount,
  onAddToChat,
  onEditCell,
  onFilterByCellValue,
  onRun,
  onRefresh,
  onStop,
  onViewExecution,
  insertDisabled,
  duplicateDisabled,
  deleteDisabled,
  onInsertAbove,
  onInsertBelow,
  onDuplicate,
  onDelete,
}: CellMenuOptions): MenuAction[] {
  const count = selectedRowCount.toLocaleString(LOCALE)
  const many = selectedRowCount > 1
  const runLabel = workflowCellScoped
    ? many
      ? `Run cell on ${count} rows`
      : 'Run cell'
    : many
      ? `Run empty or failed cells on ${count} rows`
      : 'Run empty or failed cells'
  const refreshLabel = workflowCellScoped
    ? many
      ? `Re-run cell on ${count} rows`
      : 'Re-run cell'
    : many
      ? `Re-run all cells on ${count} rows`
      : 'Re-run all cells'
  const stopLabel =
    runningCount === 1 ? 'Stop running workflow' : `Stop ${runningCount} running workflows`

  const scoped: MenuAction[] = []
  if (onAddToChat) {
    scoped.push({
      id: 'add-to-chat',
      label: onAddToChat.cellScoped
        ? 'Add cell range to Chat'
        : onAddToChat.rowCount > 1
          ? `Add ${onAddToChat.rowCount.toLocaleString(LOCALE)} rows to Chat`
          : 'Add row to Chat',
      icon: 'I073',
      onSelect: onAddToChat.onSelect,
    })
  }
  if (onEditCell) {
    scoped.push({
      id: 'edit-cell',
      label: 'Edit cell',
      icon: 'I036',
      disabled: onEditCell.disabled,
      onSelect: onEditCell.onSelect,
    })
  }
  if (onFilterByCellValue) {
    scoped.push({
      id: 'filter-by-value',
      label: 'Filter by cell value',
      icon: 'filter',
      onSelect: onFilterByCellValue,
    })
  }
  if (onRun) scoped.push({ id: 'run', label: runLabel, icon: 'play', onSelect: onRun })
  if (onRefresh)
    scoped.push({ id: 'refresh', label: refreshLabel, icon: 'I065', onSelect: onRefresh })
  if (onStop && runningCount > 0) {
    scoped.push({ id: 'stop', label: stopLabel, icon: 'I035', onSelect: onStop })
  }
  if (onViewExecution) {
    scoped.push({
      id: 'view-execution',
      label: 'View execution',
      icon: 'eye',
      onSelect: onViewExecution,
    })
  }

  return [
    ...scoped,
    {
      id: 'insert-above',
      label: 'Insert row above',
      icon: 'I023',
      separatorBefore: scoped.length > 0,
      disabled: insertDisabled,
      onSelect: onInsertAbove,
    },
    {
      id: 'insert-below',
      label: 'Insert row below',
      icon: 'I102',
      disabled: insertDisabled,
      onSelect: onInsertBelow,
    },
    {
      id: 'duplicate',
      label: 'Duplicate row',
      icon: 'duplicate',
      disabled: duplicateDisabled || many,
      onSelect: onDuplicate,
    },
    {
      id: 'delete',
      label: many ? `Delete ${count} rows` : 'Delete row',
      icon: 'trash',
      separatorBefore: true,
      destructive: true,
      disabled: deleteDisabled,
      onSelect: onDelete,
    },
  ]
}
