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
 * `components/cells/cell-render.test.ts` for the property that makes that safe.
 *
 * This is the unit barrel: import from `@/components/resources/table-view`, not
 * from a file inside it. The exception is a `lazy()`/`dynamic()` split point,
 * which must use a deep path — `apps/sim` has no `sideEffects: false`, so routing
 * a split point through a barrel silently re-attaches the chunk.
 *
 * Deliberately the ONE unit with no `table-view.tsx`. `file-view`, `log-view` and
 * `knowledge-view` each export a single component mounted against source, grants
 * and host; a table has no equivalent read surface yet, because everything that
 * draws a grid today also writes one. Until that shell is split, `table` is
 * absent from the check's `CANONICAL_UNITS` view list and this stays a component
 * library that happens to live beside the views. The file layout matches theirs
 * — `components/<child>/`, `utils/`, `types.ts` — so the day a `TableView` lands,
 * it lands in the shape everything else already has.
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
