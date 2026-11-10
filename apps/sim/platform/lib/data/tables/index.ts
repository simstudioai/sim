/**
 * The Tables tab's logic seam. The list and the grid read the legacy table hooks, the column-type
 * registry, the query builder and the grid's pure helpers unchanged; only their views are ported
 * into the zone. Values the zone needs from `@/lib/table` come from its leaf modules, never the
 * barrel, which reaches server code.
 */

export type { TableCellSelection } from '@sim/realtime-protocol/table-presence'
export {
  exceedsTablePasteRowLimit,
  parseBoundedTsv,
} from '@/components/tables/components/table-grid/table-paste'
export type { DisplayColumn } from '@/components/tables/components/table-grid/types'
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
  horizontalEdgeScrollVelocity,
  isCellInSelection,
  moveCell,
  type NormalizedSelection,
  ROW_SELECTION_ALL,
  ROW_SELECTION_NONE,
  type RowSelection,
  resolveCellExec,
  rowSelectionCoversAll,
  rowSelectionIncludes,
  rowSelectionIsEmpty,
  rowSelectionMaterialize,
  selectedColumnIds,
} from '@/components/tables/components/table-grid/utils'
export { getTimezoneEditBlockedMessage } from '@/components/tables/components/timezone-editing'
export { useTableEventStream } from '@/components/tables/hooks/use-table-event-stream'
export {
  tablesListPreferenceConfig,
  tablesParsers,
  tablesSortParams,
  tablesUrlKeys,
} from '@/components/tables/list/search-params'
export {
  type BlockedTableAction,
  describeBlockedAction,
  LOCK_FIELDS,
  LOCK_TOOLTIPS,
  lockedNouns,
} from '@/components/tables/lock-copy'
export type {
  ContextMenuState,
  EditingCell,
  QueryOptions,
  RowInsertTarget,
  SaveReason,
} from '@/components/tables/types'
export {
  cleanCellValue,
  dateValueToLocalParts,
  displayToStorage,
  formatValueForInput,
  generateColumnName,
  localPartsToDateValue,
  storageToDisplay,
  todayLocalCalendarDate,
} from '@/components/tables/utils'
export { findValidationIssue, isValidationError } from '@/lib/api/client/errors'
export type { WorkflowLogRow } from '@/lib/api/contracts/logs'
export type {
  ActiveDispatch,
  AddWorkflowGroupBodyInput,
  RunLimit,
  RunMode,
  TableFindMatch,
  UpdateWorkflowGroupBodyInput,
} from '@/lib/api/contracts/tables'
export { BASE_EXECUTION_CHARGE } from '@/lib/billing/constants'
export {
  apportionCredits,
  dollarsToCredits,
  formatCreditCost,
} from '@/lib/billing/credits/conversion'
export { faviconSrc } from '@/lib/favicon/url'
export {
  filterHiddenOutputKeys,
  hasUnhandledError,
} from '@/lib/logs/execution/trace-spans/trace-spans'
export type { TraceSpan } from '@/lib/logs/types'
export { attachSelectionContextToClipboard } from '@/lib/mothership/chat/selection-clipboard'
export { captureClientEvent } from '@/lib/posthog/client'
export { columnMatchesRef, getColumnId } from '@/lib/table/column-keys'
export { columnTypeForLeaf, deriveOutputColumnName } from '@/lib/table/column-naming'
export {
  ALL_COLUMN_TYPES,
  columnTypeById,
  columnTypeOf,
  wouldExceedColumnTypeLimit,
} from '@/lib/table/column-types'
export {
  generateUniqueTableName,
  MAX_TABLE_BATCH_ITEMS,
  TABLE_LIMITS,
} from '@/lib/table/constants'
export {
  DEFAULT_CURRENCY_CODE,
  getCurrencyOptions,
  resolveCurrencyCode,
} from '@/lib/table/currency'
export { isCalendarDateString } from '@/lib/table/dates'
export {
  getUnmetGroupDeps,
  isEmptyCellValue,
} from '@/lib/table/deps'
export {
  cellValueFilterConditions,
  withCellValueFilter,
} from '@/lib/table/query-builder/cell-filter'
export {
  COMPARISON_OPERATORS,
  MULTI_SELECT_FILTER_OPERATORS,
  SINGLE_SELECT_FILTER_OPERATORS,
} from '@/lib/table/query-builder/constants'
export {
  filterRulesToPredicate,
  predicateToFilterRules,
  prunePredicateForColumns,
  VALUELESS_OPS,
} from '@/lib/table/query-builder/converters'
export {
  todayAtTtlOffset,
  ttlValueFromPicker,
  ttlValueToPickerParts,
} from '@/lib/table/ttl-values'
export type {
  ColumnDefinition,
  EnrichmentProviderOutcome,
  EnrichmentRunDetail,
  FilterRule,
  Predicate,
  RowExecutionMetadata,
  SelectOption,
  SortDirection,
  SortSpec,
  TableDefinition,
  TableLocks,
  TableMetadata,
  TablePredicate,
  TableRow,
  WorkflowGroup,
  WorkflowGroupDependencies,
  WorkflowGroupInputMapping,
  WorkflowGroupOutput,
} from '@/lib/table/types'
export { resolveWorkflowGroupDeploymentMode } from '@/lib/table/workflow-groups/deployment-mode'
export { SEARCH_DEBOUNCE_MS, SORT_DIRECTIONS } from '@/lib/url-state'
export { normalizeInputFormatValue } from '@/lib/workflows/input-format'
/** The workflow, enrichment and execution panels: run inputs, the enrichment catalog, a run's log. */
export type { InputFormatField } from '@/lib/workflows/types'
export { getUserColor, USER_COLORS } from '@/lib/workspaces/colors'
export { ALL_ENRICHMENTS, getEnrichment } from '@/enrichments/registry'
export type { EnrichmentConfig } from '@/enrichments/types'
export { type TimezoneState, useTimezone, useTimezoneState } from '@/hooks/queries/general-settings'
export { useLogByExecutionId } from '@/hooks/queries/logs'
export {
  consumeInitiatedExport,
  downloadExportResult,
  exportTable,
  tableRowsInfiniteOptions,
  useAddTableColumn,
  useAddWorkflowGroup,
  useBatchCreateTableRows,
  useBatchUpdateTableRows,
  useBulkDeleteTables,
  useBulkMoveTables,
  useCancelTableRuns,
  useCreateTable,
  useCreateTableRow,
  useDeleteColumn,
  useDeleteTable,
  useDeleteTableRow,
  useDeleteTableRows,
  useDeleteTableRowsAsync,
  useDeleteWorkflowGroup,
  useEnrichmentDetail,
  useExportTable,
  useFindTableRows,
  useInfiniteTableRows,
  useRenameTable,
  useRunColumn,
  useTable,
  useTableRunState,
  useTablesList,
  useUpdateColumn,
  useUpdateTableLocks,
  useUpdateTableMetadata,
  useUpdateTableRow,
  useUpdateWorkflowGroup,
  useWorkspaceExportJobs,
} from '@/hooks/queries/tables'
export {
  countLoadedTableRows,
  hasMoreTableRows,
} from '@/hooks/queries/utils/table-rows-pagination'
export { useWorkspaceFileLookup } from '@/hooks/queries/workspace-files'
export { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'
export { useInlineRename } from '@/hooks/use-inline-rename'
export { extractCreatedRowId, useTableUndo } from '@/hooks/use-table-undo'
export { useWorkspaceTablesRoom } from '@/hooks/use-workspace-tables-room'
/** Add to Chat opens a new chat with the selection as a draft, the same way the Files tab does. */
export { useAddToChat } from '@/platform/lib/data/files/add-to-chat'
export { useTraceVisibility, useTroubleshootRun } from '@/platform/lib/data/tables/execution'
export { useWorkspaceUserPermissions } from '@/platform/lib/data/tables/permissions'
export { useTableRecord } from '@/platform/lib/data/tables/record'
export { type RemoteTableSelection, useTableRoom } from '@/platform/lib/data/tables/room'
export type { DeletedRowSnapshot } from '@/stores/table/types'
export type { WorkflowMetadata } from '@/stores/workflows/registry/types'
export { normalizeToolId } from '@/tools/normalize'
