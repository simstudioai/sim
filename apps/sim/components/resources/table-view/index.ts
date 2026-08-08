/**
 * The table resource view. Consumers mount {@link TableView} against a source,
 * grants and a host; everything else here is what the surrounding surfaces need
 * to describe a table without opening it.
 *
 * The view reads and writes — like {@link FileView}, and unlike the read-only
 * split this unit briefly held. What it does NOT hold is route context: no
 * router, no params, no permission context. Capability arrives as `grants`,
 * addressing as ids the host resolves, navigation as `onNavigate`.
 *
 * This is the unit barrel: import from `@/components/resources/table-view`, not
 * from a file inside it. The exception is a `lazy()`/`dynamic()` split point,
 * which must use a deep path — `apps/sim` has no `sideEffects: false`, so routing
 * a split point through a barrel silently re-attaches the chunk.
 */

export {
  CellContent,
  CellRender,
  type CellRenderKind,
  resolveCellRender,
} from '@/components/resources/table-view/components/cells'
export { DataRow, type DataRowProps } from '@/components/resources/table-view/components/data-row'
export {
  ColumnHeaderMenu,
  ColumnOptionsMenu,
  ColumnTypeIcon,
  columnTypeIcon,
  WorkflowGroupMetaCell,
} from '@/components/resources/table-view/components/headers'
export { RemoteSelectionOverlay } from '@/components/resources/table-view/components/remote-selection-overlay'
export {
  resolveSelectOptions,
  SelectPill,
  selectedOptionIds,
  toSelectedIds,
} from '@/components/resources/table-view/components/select-pill'
export {
  TableFind,
  type TableFindProps,
} from '@/components/resources/table-view/components/table-find'
export {
  AddRowButton,
  SelectAllCheckbox,
  TableColGroup,
} from '@/components/resources/table-view/components/table-primitives'
export { TableView, type TableViewProps } from '@/components/resources/table-view/table-view'
export type {
  BlockIconInfo,
  ColumnSourceInfo,
  DisplayColumn,
  EditingCell,
  RemoteTableSelection,
  SaveReason,
} from '@/components/resources/table-view/types'
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
} from '@/components/resources/table-view/utils/constants'
export {
  buildHeaderGroups,
  buildTableSelectionContext,
  type CellCoord,
  canWriteRowsWithChip,
  checkboxColLayout,
  chipRowCount,
  classifyExecStatusMix,
  collectRowSnapshots,
  computeNormalizedSelection,
  drainTargetForChip,
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
  selectedColumnIds,
} from '@/components/resources/table-view/utils/selection'
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
} from '@/components/resources/table-view/utils/values'
