/**
 * The table resource's view layer — everything that draws a table and nothing
 * that writes one.
 *
 * Moved out of `app/workspace/[workspaceId]/tables/[tableId]/` so it stops being
 * addressable only from inside the workspace route tree. The editing shell
 * (`TableGrid` and the mutation surfaces it owns) stays behind and mounts these;
 * the dependency runs shell → unit and never back.
 *
 * The split line is the write path. Nothing exported here mounts a mutation, reads
 * a permission context, or calls `useParams()`; the two props that would carry
 * workspace identity — `CellContent.workspaceId` and `DataRow.workspaceId` — are
 * optional precisely so a surface without one can render. See
 * `cells/cell-render.test.ts` for the property that makes that safe.
 *
 * This is the unit barrel: import from `@/components/resources/table-view`, not
 * from a file inside it. The exception is a `lazy()`/`dynamic()` split point,
 * which must use a deep path — `apps/sim` has no `sideEffects: false`, so routing
 * a split point through a barrel silently re-attaches the chunk.
 */

export { CellContent, CellRender, type CellRenderKind, resolveCellRender } from './cells'
export {
  ADD_COL_WIDTH,
  CELL,
  CELL_CHECKBOX,
  CELL_CONTENT,
  CELL_HEADER_CHECKBOX,
  COL_WIDTH,
  COLUMN_SIDEBAR_WIDTH,
  SELECTION_OVERLAY,
  SELECTION_TINT_BG,
} from './constants'
export { DataRow, type DataRowProps } from './data-row'
export {
  ColumnHeaderMenu,
  ColumnOptionsMenu,
  ColumnTypeIcon,
  columnTypeIcon,
  WorkflowGroupMetaCell,
} from './headers'
export { RemoteSelectionOverlay } from './remote-selection-overlay'
export {
  resolveSelectOptions,
  SelectPill,
  selectedOptionIds,
  toSelectedIds,
} from './select-pill'
export { TableFind, type TableFindProps } from './table-find'
export { AddRowButton, SelectAllCheckbox, TableColGroup } from './table-primitives'
export { TableView, type TableViewProps } from './table-view'
export type {
  BlockIconInfo,
  ColumnSourceInfo,
  DisplayColumn,
  EditingCell,
  RemoteTableSelection,
  SaveReason,
} from './types'
export {
  buildHeaderGroups,
  type CellCoord,
  checkboxColLayout,
  classifyExecStatusMix,
  collectRowSnapshots,
  computeNormalizedSelection,
  type ExecStatusMix,
  expandToDisplayColumns,
  type HeaderGroup,
  isCellInSelection,
  moveCell,
  type NormalizedSelection,
  ROW_SELECTION_ALL,
  ROW_SELECTION_NONE,
  type RowSelection,
  readExecution,
  resolveCellExec,
  rowSelectionCoversAll,
  rowSelectionIncludes,
  rowSelectionIsEmpty,
  rowSelectionMaterialize,
} from './utils'
export {
  cleanCellValue,
  type DateCellLocalParts,
  dateValueToLocalParts,
  displayToStorage,
  formatValueForInput,
  generateColumnName,
  localPartsToDateValue,
  storageToDisplay,
  todayLocalCalendarDate,
} from './values'
