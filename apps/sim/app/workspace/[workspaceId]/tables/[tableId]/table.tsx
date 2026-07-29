'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Chip, ChipConfirmModal, toast } from '@sim/emcn'
import { Download, Lock, Pencil, Table as TableIcon, Trash, Upload } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import type { RunLimit, RunMode, TableViewWire } from '@/lib/api/contracts/tables'
import { captureEvent } from '@/lib/posthog/client'
import type {
  ColumnDefinition,
  Filter,
  Sort,
  SortDirection,
  TableMetadata,
  TableRow as TableRowType,
  TableViewConfig,
  WorkflowGroup,
} from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  filterRulesToPredicate,
  filterToRules,
  predicateToFilter,
} from '@/lib/table/query-builder/converters'
import {
  type BreadcrumbItem,
  type ColumnOption,
  Resource,
  type SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ImportCsvDialog } from '@/app/workspace/[workspaceId]/tables/components/import-csv-dialog'
import { ImportProgressMenu } from '@/app/workspace/[workspaceId]/tables/components/import-progress-menu'
import { useLogByExecutionId } from '@/hooks/queries/logs'
import {
  downloadTableExport,
  useCancelTableRuns,
  useCreateTableView,
  useDeleteTable,
  useDeleteTableRowsAsync,
  useDeleteTableView,
  useExportTableAsync,
  useRenameTable,
  useRunColumn,
  useTableViews,
  useUpdateTableMetadata,
  useUpdateTableView,
} from '@/hooks/queries/tables'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import type { DeletedRowSnapshot } from '@/stores/table/types'
import {
  type ColumnConfig,
  ColumnConfigSidebar,
  ColumnsMenu,
  EnrichmentDetails,
  EnrichmentsSidebar,
  LockSettingsModal,
  NewColumnDropdown,
  RowModal,
  RunStatusControl,
  SaveViewModal,
  type SelectionSnapshot,
  TableActionBar,
  TableFilter,
  TableGrid,
  ViewsMenu,
  type WorkflowConfig,
  WorkflowSidebar,
} from './components'
import { COLUMN_SIDEBAR_WIDTH } from './components/table-grid/constants'
import { COLUMN_TYPE_ICONS } from './components/table-grid/headers'
import { useTable, useTableEventStream } from './hooks'
import { type BlockedTableAction, describeBlockedAction, lockedNouns } from './lock-copy'
import {
  ALL_VIEW_PARAM,
  DEFAULT_TABLE_DETAIL_SORT_DIRECTION,
  tableDetailParsers,
  tableDetailUrlKeys,
} from './search-params'
import type { QueryOptions } from './types'
import { generateColumnName } from './utils'

const logger = createLogger('Table')

/** Blocked-action toasts carry a button, so they linger past the 5s default. */
const BLOCKED_TOAST_MS = 8000

interface TableProps {
  /** When set, the table renders without its page header / breadcrumbs / page-level
   *  options bar. Used by the mothership chat panel to embed a table inline. */
  embedded?: boolean
  /** Identifiers — only set in embedded mode. Page mode reads from `useParams()`. */
  workspaceId?: string
  tableId?: string
  /**
   * Whether an admin may CHANGE locks, resolved server-side by the page (the
   * flag's gating lives in AppConfig and has no client counterpart). Defaults
   * to false so embedded renders, which have no server resolution, fail closed
   * — enforcement of stored locks is unaffected either way.
   */
  tableLocksEnabled?: boolean
  /**
   * Resolved `table-views` flag. Server-only to resolve for the same reason.
   * Defaults to `false` so the embedded mothership table — which has no server
   * context to resolve it — stays on today's Filter/Sort bar.
   */
  viewsEnabled?: boolean
}

/**
 * Discriminated union encoding the at-most-one-open invariant for the three
 * right-edge slideout panels. Driven by a `useReducer` so every transition
 * goes through one place — opening a column config can't accidentally leave a
 * workflow config open.
 */
type SlideoutState =
  | { kind: 'none' }
  | { kind: 'column'; config: ColumnConfig }
  | { kind: 'enrichments'; editGroup?: WorkflowGroup }
  | { kind: 'workflow'; config: WorkflowConfig }
  | { kind: 'execution'; executionId: string }
  | { kind: 'enrichment-details'; rowId: string; groupId: string }

type SlideoutAction =
  | { type: 'OPEN_COLUMN'; config: ColumnConfig }
  | { type: 'OPEN_ENRICHMENTS'; editGroup?: WorkflowGroup }
  | { type: 'OPEN_WORKFLOW'; config: WorkflowConfig }
  | { type: 'OPEN_EXECUTION'; executionId: string }
  | { type: 'OPEN_ENRICHMENT_DETAILS'; rowId: string; groupId: string }
  | { type: 'CLOSE' }

function slideoutReducer(_state: SlideoutState, action: SlideoutAction): SlideoutState {
  switch (action.type) {
    case 'OPEN_COLUMN':
      return { kind: 'column', config: action.config }
    case 'OPEN_ENRICHMENTS':
      return { kind: 'enrichments', editGroup: action.editGroup }
    case 'OPEN_WORKFLOW':
      return { kind: 'workflow', config: action.config }
    case 'OPEN_EXECUTION':
      return { kind: 'execution', executionId: action.executionId }
    case 'OPEN_ENRICHMENT_DETAILS':
      return { kind: 'enrichment-details', rowId: action.rowId, groupId: action.groupId }
    case 'CLOSE':
      return { kind: 'none' }
  }
}

/** Stable identity so a loading/disabled views query doesn't remint `[]` each render. */
const NO_VIEWS: TableViewWire[] = []

/** `blank` starts the view from "All" (no filter/sort/hidden) so it is configured
 *  after naming, rather than capturing whatever is currently applied. */
type ViewModalState =
  | { mode: 'create'; blank?: boolean }
  | { mode: 'rename'; viewId: string }
  | null

/**
 * Order-insensitive JSON, used to compare a locally-built config against one that
 * has round-tripped through Postgres. `jsonb` does not preserve object key order
 * (`{status,plan}` comes back `{plan,status}`), so a plain `JSON.stringify` would
 * report any multi-key filter as permanently dirty. Array order is preserved —
 * it is meaningful for `columnOrder`.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

/**
 * Structural equality for the parts of a view config the user edits directly.
 * Column layout (widths/order/pinning) is excluded — it auto-saves into the
 * active view as the user drags, so it can never be the thing that is "unsaved".
 *
 * Compares serialized form rather than field-by-field because `filter` is an
 * arbitrarily nested predicate tree.
 */
function isSameViewConfig(a: TableViewConfig, b: TableViewConfig): boolean {
  const normalize = (config: TableViewConfig) =>
    stableStringify({
      filter: config.filter ?? null,
      sort: config.sort ?? null,
      hiddenColumns: [...(config.hiddenColumns ?? [])].sort(),
    })
  return normalize(a) === normalize(b)
}

/**
 * Page-level wrapper for the table detail view. Mirrors the shape of
 * `logs/logs.tsx`: a thin orchestrator that composes the data grid (`<TableGrid>`)
 * and the page-level surface (sidebars, modals, action bar, breadcrumbs).
 *
 * Owns the at-most-one-open invariant for the three slideout panels (column
 * config, workflow config, execution details) via a single reducer. The grid
 * emits open requests via callbacks; the wrapper renders the panels.
 *
 * Embedded mode skips the page header but otherwise renders the same surface.
 */
export function Table({
  embedded,
  workspaceId: propWorkspaceId,
  tableId: propTableId,
  tableLocksEnabled = false,
  viewsEnabled = false,
}: TableProps = {}) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const tableId = propTableId || (params.tableId as string)

  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog

  const { navigateToSettings } = useSettingsNavigation()
  // Plain function: `useTableEventStream` keeps it in a ref (its effect doesn't
  // depend on the identity), so a stable reference buys nothing here.
  const onUsageLimitReached = ({ message }: { dispatchId?: string; message: string }) => {
    toast.error(message, {
      action: { label: 'Upgrade', onClick: () => navigateToSettings({ section: 'billing' }) },
    })
  }
  useTableEventStream({ tableId, workspaceId, onUsageLimitReached })

  const [slideout, dispatch] = useReducer(slideoutReducer, { kind: 'none' })
  const [showDeleteTableConfirm, setShowDeleteTableConfirm] = useState(false)
  const [showLockSettings, setShowLockSettings] = useState(false)
  // Id of the last blocked-action toast, so a user who keeps typing into a
  // locked cell replaces one notice rather than stacking a column of them.
  const blockedToastIdRef = useRef<string | null>(null)
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<TableRowType | null>(null)
  const [deletingRows, setDeletingRows] = useState<DeletedRowSnapshot[]>([])
  const [deletingAll, setDeletingAll] = useState<{
    excludeRowIds: string[]
    estimatedCount: number
  } | null>(null)
  const [deletingColumns, setDeletingColumns] = useState<string[] | null>(null)
  const [selection, setSelection] = useState<SelectionSnapshot>({
    actionBarRowIds: [],
    runningInActionBarSelection: 0,
    totalRunning: 0,
    hasRunningCell: false,
    hasActiveDispatch: false,
    hasWorkflowColumns: false,
    selectedRunScope: null,
    selectionStats: { hasIncompleteOrFailed: false, hasCompleted: false, hasInFlight: false },
    singleWorkflowCell: null,
  })
  const [filter, setFilter] = useState<Filter | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  /** Hidden **column ids**. Lives here (not in the grid) because the filter
   *  panel's Columns section edits it and the active view persists it. */
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])

  const [{ sort: sortColumn, dir: sortDirection, view: activeViewId }, setTableParams] =
    useQueryStates(tableDetailParsers, tableDetailUrlKeys)

  // Read-only mirrors for the resolve effect: it must know whether the user has
  // already applied a filter / hidden columns without re-running when they change.
  const filterRef = useRef(filter)
  filterRef.current = filter
  const hiddenColumnsRef = useRef(hiddenColumns)
  hiddenColumnsRef.current = hiddenColumns

  /** Resolved single-column sort, or `null` when no column is active. */
  const sortQuery = useMemo<Sort | null>(
    () => (sortColumn ? { [sortColumn]: sortDirection } : null),
    [sortColumn, sortDirection]
  )

  const queryOptions = useMemo<QueryOptions>(
    () => ({ filter, sort: sortQuery }),
    [filter, sortQuery]
  )

  const userPermissions = useUserPermissionsContext()

  const onOpenColumnConfig = useCallback((config: ColumnConfig) => {
    dispatch({ type: 'OPEN_COLUMN', config })
  }, [])
  const onOpenWorkflowConfig = useCallback((config: WorkflowConfig) => {
    dispatch({ type: 'OPEN_WORKFLOW', config })
  }, [])
  const onOpenEnrichments = useCallback(() => {
    dispatch({ type: 'OPEN_ENRICHMENTS' })
  }, [])
  const onOpenEnrichmentConfig = useCallback((editGroup: WorkflowGroup) => {
    dispatch({ type: 'OPEN_ENRICHMENTS', editGroup })
  }, [])
  const onOpenExecutionDetails = useCallback((executionId: string) => {
    dispatch({ type: 'OPEN_EXECUTION', executionId })
  }, [])
  const onOpenEnrichmentDetails = useCallback((rowId: string, groupId: string) => {
    dispatch({ type: 'OPEN_ENRICHMENT_DETAILS', rowId, groupId })
  }, [])
  const onCloseSlideout = () => dispatch({ type: 'CLOSE' })
  const onOpenRowModal = (row: TableRowType) => setEditingRow(row)
  // useCallback because <Resource.Header> is memo-wrapped — these flow into
  // the breadcrumbs / headerActions memos, whose identity drives that re-render.
  const onRequestDeleteTable = useCallback(() => setShowDeleteTableConfirm(true), [])
  const onRequestImportCsv = useCallback(() => setIsImportCsvOpen(true), [])
  // Used inside grid's `useCallback` deps — identity stability prevents the
  // grid's `useCallback` from re-creating on every wrapper re-render.
  const onRequestDeleteRows = useCallback((snapshots: DeletedRowSnapshot[]) => {
    setDeletingRows(snapshots)
  }, [])
  const onRequestDeleteAllByFilter = useCallback(
    (params: { excludeRowIds: string[]; estimatedCount: number }) => {
      setDeletingAll(params)
    },
    []
  )
  const onRequestDeleteColumns = useCallback((names: string[]) => {
    setDeletingColumns(names)
  }, [])

  /**
   * Sink populated by the grid: invoked from sidebar `onColumnRename` so the
   * grid can rewrite its local `columnWidths` / `columnOrder` keys after a
   * rename. The grid's render assigns to `current`; the wrapper forwards calls.
   */
  const columnRenameSinkRef = useRef<((oldName: string, newName: string) => void) | null>(null)
  const onColumnRename = (oldName: string, newName: string) => {
    columnRenameSinkRef.current?.(oldName, newName)
  }

  /**
   * Sink the grid populates with its post-row-delete cleanup (push undo,
   * clear selection). The wrapper invokes after the row-delete modal's
   * mutation succeeds.
   */
  const afterDeleteRowsSinkRef = useRef<((snapshots: DeletedRowSnapshot[]) => void) | null>(null)

  /** Sink the grid populates with its post-select-all-delete cleanup (clear selection). */
  const afterDeleteAllSinkRef = useRef<(() => void) | null>(null)

  /**
   * Sink the grid populates with its full delete-columns cascade (per-column
   * mutation, undo push, columnOrder + columnWidths cleanup). The wrapper's
   * delete-columns confirmation modal invokes this on confirm.
   */
  const confirmDeleteColumnsSinkRef = useRef<((names: string[]) => void) | null>(null)

  /**
   * Sink the grid populates with its `pushUndo({ type: 'rename-table', ... })`
   * call so the wrapper's breadcrumb rename can register an undo entry on the
   * grid's undo stack.
   */
  const pushTableRenameUndoSinkRef = useRef<
    ((previousName: string, newName: string) => void) | null
  >(null)

  const { data: viewsData, isError: viewsErrored } = useTableViews({
    workspaceId,
    tableId,
    enabled: viewsEnabled,
  })
  const views = viewsData ?? NO_VIEWS
  /** A views list exists — fresh or cached. A failed background refetch flips
   *  `isError` while the cached list stays perfectly usable (and every view
   *  mutation invalidates this query), so success/error is the wrong axis:
   *  what matters is whether there is a list to resolve against. */
  const viewsAvailable = viewsData !== undefined

  // Single source of truth for `useTable` — drives both the grid render and
  // the wrapper's slideouts/modals. The grid receives the bundle as props.
  const {
    tableData,
    columns,
    tableWorkflowGroups,
    workflows,
    // Server-bound scopes use this: a filter condition the current schema
    // invalidated is pruned from the rows query, so the delete must target the
    // same predicate the grid is displaying.
    filter: effectiveFilter,
  } = useTable({
    workspaceId,
    tableId,
    queryOptions,
  })
  const createViewMutation = useCreateTableView({ workspaceId, tableId })
  const updateViewMutation = useUpdateTableView({ workspaceId, tableId })
  const updateMetadataMutation = useUpdateTableMetadata({ workspaceId, tableId })
  const deleteViewMutation = useDeleteTableView({ workspaceId, tableId })

  /** The selected view, or `null` for the built-in "All" state. A view id that no
   *  longer resolves (deleted, stale bookmark) falls back to "All" rather than
   *  rendering an empty view. */
  const activeView = activeViewId ? (views.find((view) => view.id === activeViewId) ?? null) : null

  const [viewModal, setViewModal] = useState<ViewModalState>(null)
  /** Which view id the local filter/sort/hidden state was last seeded from.
   *  `undefined` means "nothing seeded yet" so the first resolve still runs. */
  const seededViewIdRef = useRef<string | null | undefined>(undefined)

  /**
   * A view this client just created, held only until the list refetch carries it.
   * Distinct from `seededViewIdRef`, which is stamped on EVERY selection — reusing
   * that for the create race also matched a view that had been selected normally
   * and then deleted, so the delete never cleaned up.
   */
  const pendingCreatedViewIdRef = useRef<string | null>(null)

  /**
   * Applies a view's config to the live state. `keep` marks slices the user has
   * already set by hand, which win over the view's stored values on the FIRST
   * resolve only — a deep-linked `?sort=` is more specific than the view's default,
   * and a filter typed while the views query was still in flight shouldn't be
   * thrown away when it lands. Switching views later passes no `keep`, so the
   * incoming view fully replaces the outgoing one.
   */
  const applyViewConfig = useCallback(
    (
      config: TableViewConfig | null,
      keep?: { sort?: boolean; filter?: boolean; hiddenColumns?: boolean }
    ) => {
      // Stored views speak the v2 grammar; the grid's runtime state is still the
      // legacy Filter/Sort pair, so translate at this boundary. A stored predicate
      // is always builder-authored (the save path converts from builder output),
      // so the legacy projection is total here.
      if (!keep?.filter) setFilter(config?.filter ? predicateToFilter(config.filter) : null)
      if (!keep?.hiddenColumns) setHiddenColumns(config?.hiddenColumns ?? [])
      if (keep?.sort) return
      const sortEntry = config?.sort?.[0]
      setTableParams({
        sort: sortEntry ? sortEntry.field : null,
        dir: sortEntry ? (sortEntry.direction as SortDirection) : null,
      })
    },
    [setTableParams]
  )

  /** Reader for the grid's CURRENT column layout, populated by the grid itself.
   *  The grid owns widths/order/pinning, so the wrapper asks at the moment it
   *  needs them instead of mirroring every patch — a mirror only stays right
   *  while every write flows through it, and layout writes bypass it whenever
   *  All is active. */
  const layoutSnapshotRef = useRef<(() => TableMetadata) | null>(null)
  const readLayout = useCallback((): TableMetadata => layoutSnapshotRef.current?.() ?? {}, [])

  /** Layout KEYS the user changed before the views query settled, when there was
   *  no owner to write to. Values aren't recorded — the grid holds them live —
   *  but the keys are, so a settle to All persists only what was touched. A full
   *  snapshot would also carry keys the grid hasn't seeded yet (e.g. pins while
   *  the slower detail query is still in flight) and wipe them in metadata. */
  const pendingLayoutKeysRef = useRef<Set<keyof TableMetadata> | null>(null)

  /** Whether the resolve effect has decided the initial owner — including the
   *  terminal-error fallback to All. Until then a write that reads "All" might
   *  actually belong to a default view about to be adopted, so it buffers. */
  const ownerResolvedRef = useRef(false)

  /**
   * Resolves that pending layout once the resolve effect has picked an owner.
   *
   * Settling on All re-seeds nothing — `viewLayoutKey` never changed — so the
   * user's resize is still on screen and has to be persisted or it silently
   * disappears on refresh. Adopting a view instead re-seeds the grid from that
   * view's config, which already replaced the gesture on screen, so it is dropped.
   *
   * Called from the resolve effect rather than keyed on `activeView`: adoption
   * writes the view id through the URL, so for one render the query has settled
   * while `activeView` is still null, and an effect would flush to All in exactly
   * the case that must drop.
   */
  const resolvePendingLayout = useCallback(
    (adoptedView: boolean) => {
      const keys = pendingLayoutKeysRef.current
      pendingLayoutKeysRef.current = null
      if (!keys || keys.size === 0) return
      if (adoptedView || !userPermissions.canEdit) return
      const live = readLayout()
      const patch: TableMetadata = {}
      if (keys.has('columnWidths') && live.columnWidths) patch.columnWidths = live.columnWidths
      if (keys.has('columnOrder') && live.columnOrder) patch.columnOrder = live.columnOrder
      if (keys.has('pinnedColumns') && live.pinnedColumns) {
        patch.pinnedColumns = live.pinnedColumns
      }
      if (Object.keys(patch).length > 0) updateMetadataMutation.mutate(patch)
    },
    [userPermissions.canEdit, readLayout]
  )

  /** What the user has already set by hand, for the first-resolve `keep`. */
  const localWork = () => ({
    sort: sortColumn !== null,
    filter: filterRef.current !== null,
    hiddenColumns: hiddenColumnsRef.current.length > 0,
  })

  /**
   * Resolves the active view and seeds the local filter/sort/hidden-column state
   * from it. Runs only when the *selected view id* changes, never on every edit,
   * so ad-hoc changes on top of a view are preserved until the user switches away.
   *
   * On first load with no `?view=` the table's default view (if any) is selected
   * and written into the URL explicitly — a link then keeps resolving to the same
   * view even after someone changes which view is default.
   */
  useEffect(() => {
    if (!viewsEnabled) return
    // Terminal only when the fetch failed WITHOUT ever producing a list — then
    // the table settles to All: mark the owner resolved so layout writes flow
    // to shared metadata, and flush what was touched during the load. It does
    // NOT stamp `seededViewIdRef` — that would consume the first resolve, and a
    // later successful refetch must still run adoption (with `localWork` keep,
    // so filters set while errored survive). An error with a cached list falls
    // through — the list is still resolvable.
    if (viewsErrored && !viewsAvailable) {
      ownerResolvedRef.current = true
      resolvePendingLayout(false)
      return
    }
    if (!viewsAvailable) return
    ownerResolvedRef.current = true

    if (seededViewIdRef.current === undefined) {
      // Embedded tables bind these parsers to the HOST page's URL, which the
      // mothership panel keeps across resource switches. A view id this table
      // can't resolve was left by the previously-open resource — ignore it so
      // this table picks its own default. A param it CAN resolve is honoured,
      // including an explicit All: that is a real bookmark or a remount after
      // switching resources away and back, not leakage.
      const inheritedParams =
        embedded &&
        activeViewId !== null &&
        activeViewId !== ALL_VIEW_PARAM &&
        !views.some((view) => view.id === activeViewId)

      if (activeViewId === null || inheritedParams) {
        const defaultView = views.find((view) => view.isDefault)
        // `sort` rides the same host URL, so when the view id is inherited the
        // sort beside it is too — not local work, and it must not suppress the
        // default view's own sort.
        const keep = inheritedParams ? { ...localWork(), sort: false } : localWork()
        if (defaultView) {
          seededViewIdRef.current = defaultView.id
          setTableParams({ view: defaultView.id })
          applyViewConfig(defaultView.config, keep)
          resolvePendingLayout(true)
          return
        }
        // No view to adopt. Deliberately does NOT apply an empty config — that
        // would clear a deep-linked `?sort=` on mount. Inherited params are the
        // exception: nothing about them refers to this table, so they're cleared.
        seededViewIdRef.current = null
        if (inheritedParams) setTableParams({ view: ALL_VIEW_PARAM, sort: null, dir: null })
        resolvePendingLayout(false)
        return
      }
      if (activeViewId === ALL_VIEW_PARAM) {
        seededViewIdRef.current = null
        resolvePendingLayout(false)
        return
      }
      // A `?view=` that resolves to nothing (deleted view, stale bookmark) falls
      // back to "All" without touching state, for the same reason. An explicit
      // `?sort=` alongside `?view=` also wins over the view's stored sort.
      seededViewIdRef.current = activeView?.id ?? null
      resolvePendingLayout(activeView !== null)
      if (activeView) {
        applyViewConfig(activeView.config, localWork())
      } else {
        // Nothing to apply, but the URL still names a view that no longer exists.
        // Rewrite it so a stale bookmark can't be copied on, and so the param
        // matches the All the UI is already showing.
        setTableParams({ view: ALL_VIEW_PARAM })
      }
      return
    }

    // The id resolved, so any create race for it is over.
    if (activeView && pendingCreatedViewIdRef.current === activeView.id) {
      pendingCreatedViewIdRef.current = null
    }

    // A selected id that doesn't resolve is one of two things. Ours — creation
    // writes the URL before the list refetches, and clearing there would wipe the
    // config just saved. Or genuinely dead (deleted by someone else, stale
    // bookmark), where leaving it applied keeps the grid narrowed under an "All"
    // label, since the menu resolves the same missing view to null.
    if (activeViewId !== null && activeViewId !== ALL_VIEW_PARAM && !activeView) {
      if (pendingCreatedViewIdRef.current === activeViewId) return
      seededViewIdRef.current = null
      setTableParams({ view: ALL_VIEW_PARAM })
      applyViewConfig(null)
      return
    }

    const nextViewId = activeView?.id ?? null
    if (seededViewIdRef.current === nextViewId) return
    seededViewIdRef.current = nextViewId
    // Navigating away ends any create race — without this a reconcile on the
    // destination could fall back to the still-pending created id.
    if (pendingCreatedViewIdRef.current && pendingCreatedViewIdRef.current !== nextViewId) {
      pendingCreatedViewIdRef.current = null
    }
    applyViewConfig(activeView?.config ?? null)
  }, [
    viewsEnabled,
    viewsAvailable,
    viewsErrored,
    views,
    activeView,
    activeViewId,
    embedded,
    sortColumn,
    applyViewConfig,
    setTableParams,
    resolvePendingLayout,
  ])

  /**
   * Live state pruned the same way `pruneViewConfig` prunes the stored config on
   * read. Without this, deleting a hidden or sorted column leaves the local ids
   * behind while the server drops them, so the dirty check never balances again —
   * Save writes the stale id, the response comes back pruned, and the chip is
   * stuck on. Guarded on the schema being loaded so an empty first render doesn't
   * prune everything.
   */
  const liveColumnIds = useMemo(() => new Set(columns.map(getColumnId)), [columns])
  const effectiveHiddenColumns = useMemo(
    () =>
      columns.length === 0 ? hiddenColumns : hiddenColumns.filter((id) => liveColumnIds.has(id)),
    [columns.length, hiddenColumns, liveColumnIds]
  )

  /**
   * Drops a sort whose column was deleted by clearing the URL, rather than masking
   * it in a derived value: `queryOptions` feeds the query that produces `columns`,
   * so a pruned sort can't flow back into it without a cycle. Clearing keeps one
   * source of truth, so the rows query, the dirty check, and the Save patch can't
   * disagree about whether a sort is active.
   */
  useEffect(() => {
    if (!sortColumn || columns.length === 0) return
    if (liveColumnIds.has(sortColumn)) return
    setTableParams({ sort: null, dir: null })
  }, [sortColumn, columns.length, liveColumnIds, setTableParams])

  /** The payload for creating a view, and the left-hand side of the dirty check.
   *  Carries the current layout so "Save as view" from "All" captures the widths /
   *  order / pins the grid is rendering (they live in the table's shared metadata
   *  until a view owns them) instead of creating a layout-less view that then
   *  resets the grid. Updates never send this — they send a merge patch. */
  const currentViewConfig = useMemo<TableViewConfig>(
    () => ({
      ...(activeView?.config ?? tableData?.metadata),
      // Views store the v2 grammar; the grid runs on the legacy pair. The filter
      // is builder-authored, so the rule round-trip is lossless here.
      filter: effectiveFilter ? filterRulesToPredicate(filterToRules(effectiveFilter)) : null,
      sort: sortColumn ? [{ field: sortColumn, direction: sortDirection }] : null,
      hiddenColumns: effectiveHiddenColumns,
    }),
    [
      activeView,
      tableData?.metadata,
      effectiveFilter,
      sortColumn,
      sortDirection,
      effectiveHiddenColumns,
    ]
  )

  /**
   * The active view's stored config, pruned against the live columns exactly as
   * the local state is. The server prunes on read, but the cached copy is not
   * re-pruned when the schema changes here — so without this, deleting a hidden or
   * sorted column makes the two sides disagree and lights Save with no user edit.
   */
  const storedViewConfig = useMemo<TableViewConfig | null>(() => {
    if (!activeView) return null
    const stored = activeView.config
    if (columns.length === 0) return stored
    return {
      ...stored,
      hiddenColumns: (stored.hiddenColumns ?? []).filter((id) => liveColumnIds.has(id)),
      sort:
        stored.sort && Object.keys(stored.sort).every((id) => liveColumnIds.has(id))
          ? stored.sort
          : null,
    }
  }, [activeView, columns.length, liveColumnIds])

  /**
   * Whether the live state diverges from what the active view stores (or, on
   * "All", whether anything is applied at all). Drives the Save button — it is
   * the only affordance that persists, so ad-hoc exploration stays throwaway.
   */
  const isViewDirty = storedViewConfig
    ? !isSameViewConfig(currentViewConfig, storedViewConfig)
    : Boolean(effectiveFilter) || Boolean(sortQuery) || effectiveHiddenColumns.length > 0

  /** Rename targets a live view rather than a snapshot, so a concurrent rename or
   *  delete can't leave the modal editing stale data. */
  const renamingView =
    viewModal?.mode === 'rename' ? (views.find((v) => v.id === viewModal.viewId) ?? null) : null

  const handleSelectView = useCallback(
    (viewId: string | null) => {
      setTableParams({ view: viewId ?? ALL_VIEW_PARAM })
    },
    [setTableParams]
  )

  const handleRenameView = useCallback((viewId: string) => {
    setViewModal({ mode: 'rename', viewId })
  }, [])

  const handleNewView = useCallback(() => {
    setViewModal({ mode: 'create', blank: true })
  }, [])

  /** Column order/width/pinning auto-saves into the active view as the user drags,
   *  which is why `isSameViewConfig` excludes layout from the dirty check. Sent as
   *  a `configPatch` so the server merges it — two overlapping layout writes must
   *  not each replace the whole blob from their own snapshot. With All selected
   *  the sink is unbound and the grid writes the table's shared metadata instead;
   *  while the views query is still loading the sink IS bound and the write is
   *  suppressed, because the owner isn't known yet. */
  const handlePersistLayout = useCallback(
    (patch: TableMetadata, owner: string | null) => {
      // The resize grip and drag handles stay live for read-only members, so
      // without this a resize fires a write-gated PATCH and an error toast. Local
      // layout still updates — only the persist is suppressed.
      if (!userPermissions.canEdit) return
      // `owner` is stamped by the GRID — the layout source it was displaying
      // when the write happened — so routing no longer depends on when the
      // resolve effect ran relative to the grid's own effects. A write stamped
      // with a view id is fully addressed: route it even before the first
      // resolve (a deep-linked view's seed reconcile must persist, not buffer)
      // or before the list refetch resolves a just-created view.
      const target = owner ?? pendingCreatedViewIdRef.current
      if (target) {
        updateViewMutation.mutate(
          { viewId: target, configPatch: patch },
          { onError: (error) => toast.error(getErrorMessage(error, 'Failed to save layout')) }
        )
        return
      }
      // Owner reads "All", but the resolve effect hasn't confirmed that yet —
      // record the touched keys; `resolvePendingLayout` decides at settle.
      if (!ownerResolvedRef.current) {
        pendingLayoutKeysRef.current ??= new Set()
        for (const key of Object.keys(patch) as (keyof TableMetadata)[]) {
          pendingLayoutKeysRef.current.add(key)
        }
        return
      }
      updateMetadataMutation.mutate(patch)
    },
    [userPermissions.canEdit]
  )

  const handleSaveView = () => {
    if (activeView) {
      // Only the fields Save owns, merged server-side — never a client-built full
      // config. A full replace from a cached snapshot would drop a layout write
      // still in flight (and vice versa). `null`/`[]` merge as explicit values, so
      // clearing a filter or unhiding every column still persists as a removal.
      updateViewMutation.mutate(
        {
          viewId: activeView.id,
          configPatch: {
            filter: effectiveFilter,
            sort: sortQuery,
            hiddenColumns: effectiveHiddenColumns,
          },
        },
        { onError: (error) => toast.error(getErrorMessage(error, 'Failed to save view')) }
      )
      return
    }
    setViewModal({ mode: 'create' })
  }

  const handleSubmitViewName = (name: string) => {
    if (viewModal?.mode === 'rename') {
      updateViewMutation.mutate(
        { viewId: viewModal.viewId, name },
        {
          onSuccess: () => setViewModal(null),
          onError: (error) => toast.error(getErrorMessage(error, 'Failed to rename view')),
        }
      )
      return
    }
    // "New view" starts from All and is configured afterwards; "Save as view"
    // captures what is already applied. Both keep the current column layout so
    // creating a view never visually resets the grid.
    const blank = viewModal?.blank === true
    const config: TableViewConfig = blank
      ? {
          ...(activeView?.config ?? tableData?.metadata),
          ...readLayout(),
          filter: null,
          sort: null,
          hiddenColumns: [],
        }
      : { ...currentViewConfig, ...readLayout() }
    createViewMutation.mutate(
      { name, config },
      {
        onSuccess: (view) => {
          setViewModal(null)
          // Stamp before selecting so the resolve effect treats this as already
          // seeded — it can't tell a just-created view from a dead id otherwise.
          seededViewIdRef.current = view.id
          pendingCreatedViewIdRef.current = view.id
          setTableParams({ view: view.id })
          // Which means the blank config must be applied here; nuqs batches this
          // sort write with the `view` write above into one URL update.
          if (blank) applyViewConfig(view.config)
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to create view')),
      }
    )
  }

  const handleDeleteView = useCallback(
    (viewId: string) => {
      deleteViewMutation.mutate(viewId, {
        onSuccess: () => {
          if (viewId === activeViewId) setTableParams({ view: ALL_VIEW_PARAM })
        },
        onError: (error) => toast.error(getErrorMessage(error, 'Failed to delete view')),
      })
    },
    [activeViewId, setTableParams]
  )

  const runColumnMutation = useRunColumn({ workspaceId, tableId })
  const cancelRunsMutation = useCancelTableRuns({ workspaceId, tableId })
  const runColumnMutate = runColumnMutation.mutate
  const cancelRunsMutate = cancelRunsMutation.mutate

  // Canonical run dispatcher. Every UI gesture (column-header menu, per-row
  // gutter, action-bar Play/Refresh, right-click context menu) reduces to a
  // (groupIds, rowIds?, runMode) triple. Empty groupIds = no-op.
  const runScope = useCallback(
    (args: {
      groupIds: string[]
      rowIds?: string[]
      filter?: Filter
      excludeRowIds?: string[]
      runMode: RunMode
      limit?: RunLimit
      source: 'row' | 'rows' | 'column'
    }) => {
      const { source, ...mutateArgs } = args
      if (mutateArgs.groupIds.length === 0) return
      if (mutateArgs.rowIds && mutateArgs.rowIds.length === 0) return
      runColumnMutate(mutateArgs)
      // Derive the run's deployment mode from the targeted groups (default 'live' when unset).
      // 'mixed' when the targeted groups don't all agree.
      const targetGroupIds = new Set(mutateArgs.groupIds)
      const modes = new Set(
        tableWorkflowGroups
          .filter((g) => targetGroupIds.has(g.id))
          .map((g) => g.deploymentMode ?? 'live')
      )
      const deploymentMode = modes.size === 1 ? [...modes][0] : 'mixed'
      captureEvent(posthogRef.current, 'table_workflow_run', {
        table_id: tableId,
        workspace_id: workspaceId,
        source,
        run_mode: mutateArgs.runMode,
        group_count: mutateArgs.groupIds.length,
        row_count: mutateArgs.rowIds?.length ?? null,
        has_limit: mutateArgs.limit != null,
        deployment_mode: deploymentMode,
      })
    },
    [runColumnMutate, tableId, workspaceId, tableWorkflowGroups]
  )

  const onRunColumn = useCallback(
    (
      groupId: string,
      runMode: RunMode,
      rowIds?: string[],
      limit?: RunLimit,
      filter?: Filter,
      excludeRowIds?: string[]
    ) => {
      runScope({
        groupIds: [groupId],
        rowIds,
        filter,
        excludeRowIds,
        runMode,
        limit,
        source: 'column',
      })
    },
    [runScope]
  )

  const onRunRows = useCallback(
    (rowIds: string[] | undefined, runMode: RunMode, filter?: Filter, excludeRowIds?: string[]) => {
      runScope({
        groupIds: tableWorkflowGroups.map((g) => g.id),
        rowIds,
        filter,
        excludeRowIds,
        runMode,
        source: 'rows',
      })
    },
    [runScope, tableWorkflowGroups]
  )

  const onRunRow = useCallback(
    (rowId: string) => {
      runScope({
        groupIds: tableWorkflowGroups.map((g) => g.id),
        rowIds: [rowId],
        runMode: 'incomplete',
        source: 'row',
      })
    },
    [runScope, tableWorkflowGroups]
  )

  // useCallback because <DataRow> is React.memo-wrapped — identity stability
  // matters for per-row gutter Stop button.
  const onStopRow = useCallback(
    (rowId: string) => {
      cancelRunsMutate({ scope: 'row', rowId })
      captureEvent(posthogRef.current, 'table_workflow_stopped', {
        table_id: tableId,
        workspace_id: workspaceId,
        scope: 'row',
        row_count: 1,
      })
    },
    [cancelRunsMutate, tableId, workspaceId]
  )

  const onStopRows = (rowIds: string[]) => {
    if (rowIds.length === 0) return
    for (const rowId of rowIds) {
      cancelRunsMutate({ scope: 'row', rowId })
    }
    captureEvent(posthogRef.current, 'table_workflow_stopped', {
      table_id: tableId,
      workspace_id: workspaceId,
      scope: 'rows',
      row_count: rowIds.length,
    })
  }

  // useCallback because <RunStatusControl> is memo-wrapped. Zero-arg on
  // purpose — RunStatusControl passes it straight to onClick, which would
  // otherwise leak the MouseEvent into `filter`.
  const onStopAll = useCallback(() => {
    cancelRunsMutate({ scope: 'all' })
    captureEvent(posthogRef.current, 'table_workflow_stopped', {
      table_id: tableId,
      workspace_id: workspaceId,
      scope: 'all',
      row_count: null,
    })
  }, [cancelRunsMutate, tableId, workspaceId])

  /** Select-all Stop — filter-scoped when a filter is active; deselected rows keep running. */
  const onStopAllRows = useCallback(
    (filter?: Filter, excludeRowIds?: string[]) => {
      // `sort` scopes the optimistic flip to the active view's cache (filtered stops
      // only cancel matching rows server-side).
      cancelRunsMutate({ scope: 'all', filter, sort: queryOptions.sort, excludeRowIds })
      captureEvent(posthogRef.current, 'table_workflow_stopped', {
        table_id: tableId,
        workspace_id: workspaceId,
        scope: 'all',
        row_count: null,
      })
    },
    [cancelRunsMutate, tableId, workspaceId, queryOptions.sort]
  )

  const onSelectionChange = (next: SelectionSnapshot) => {
    setSelection(next)
  }

  const renameTableMutation = useRenameTable(workspaceId)
  const tableDataRef = useRef(tableData)
  tableDataRef.current = tableData
  const tableHeaderRename = useInlineRename({
    onSave: (_id, name) => {
      const data = tableDataRef.current
      if (data) pushTableRenameUndoSinkRef.current?.(data.name, name)
      return renameTableMutation.mutateAsync({ tableId, name })
    },
  })

  const handleNavigateBack = useCallback(() => {
    router.push(`/workspace/${workspaceId}/tables`)
  }, [router, workspaceId])

  const handleStartTableRename = useCallback(() => {
    const data = tableDataRef.current
    if (data) tableHeaderRename.startRename(tableId, data.name)
  }, [tableHeaderRename.startRename, tableId])

  const handleAddColumnOfType = (type: ColumnDefinition['type']) => {
    onOpenColumnConfig({ mode: 'create', proposedName: generateColumnName(columns), type })
  }

  const handleAddWorkflowColumn = () => {
    onOpenWorkflowConfig({
      mode: 'create',
      kind: 'manual',
      proposedName: generateColumnName(columns),
    })
  }

  const handleExportCsv = useCallback(async () => {
    if (!tableData) return
    try {
      // Big tables export as a background job (the file downloads when the job completes via the
      // SSE stream); small ones keep the instant synchronous stream. While a delete job runs,
      // rowCount is a doomed-estimate-adjusted number — not ground truth — so always take the
      // async path (safe at any size; exports bypass the one-job-per-table gate).
      const deleteRunning = tableData.jobType === 'delete' && tableData.jobStatus === 'running'
      if (deleteRunning || tableData.rowCount > TABLE_LIMITS.EXPORT_ASYNC_THRESHOLD_ROWS) {
        await exportTableAsync.mutateAsync({ format: 'csv' })
        toast.success('Export started — the download will begin when it finishes')
      } else {
        await downloadTableExport(tableData.id, tableData.name)
      }
      captureEvent(posthogRef.current, 'table_exported', {
        table_id: tableData.id,
        workspace_id: workspaceId,
      })
    } catch (err) {
      logger.error('Failed to export table:', err)
      toast.error('Failed to export table')
    }
  }, [tableData, workspaceId])

  const columnOptions = useMemo<ColumnOption[]>(
    () =>
      columns.map((col) => ({
        // `id` is the filter/sort field key (column id); `label` is what the user sees.
        id: getColumnId(col),
        label: col.name,
        type: col.type,
        icon: COLUMN_TYPE_ICONS[col.type],
      })),
    [columns]
  )

  const sortConfig = useMemo<SortConfig>(
    () => ({
      options: columnOptions,
      active: sortColumn ? { column: sortColumn, direction: sortDirection } : null,
      onSort: (column, direction) => setTableParams({ sort: column, dir: direction }),
      /**
       * Clearing writes the default direction (stripped by clearOnDefault) and
       * drops the column, leaving a clean URL with no active sort.
       */
      onClear: () => setTableParams({ sort: null, dir: DEFAULT_TABLE_DETAIL_SORT_DIRECTION }),
    }),
    [columnOptions, sortColumn, sortDirection, setTableParams]
  )

  const handleFilterApply = (next: Filter | null) => {
    setFilter(next)
  }

  const breadcrumbs = useMemo(
    (): BreadcrumbItem[] => [
      { label: 'Tables', onClick: handleNavigateBack },
      // While the table loads, mirror this route's loading.tsx (terminal "…" crumb)
      // so no empty-label / orphaned-chevron frame renders in between.
      tableData
        ? {
            label: tableData.name,
            editing: tableHeaderRename.editingId
              ? {
                  isEditing: true,
                  value: tableHeaderRename.editValue,
                  onChange: tableHeaderRename.setEditValue,
                  onSubmit: tableHeaderRename.submitRename,
                  onCancel: tableHeaderRename.cancelRename,
                }
              : undefined,
            dropdownItems: [
              {
                label: 'Rename',
                icon: Pencil,
                onClick: handleStartTableRename,
              },
              // Reachable with the flag off when something is locked, so an
              // admin can always clear locks (the route allows clearing).
              ...(userPermissions.canAdmin &&
              (tableLocksEnabled || lockedNouns(tableData.locks).length > 0)
                ? [
                    {
                      label: 'Lock settings',
                      icon: Lock,
                      onClick: () => setShowLockSettings(true),
                    },
                  ]
                : []),
              {
                label: 'Delete',
                icon: Trash,
                onClick: onRequestDeleteTable,
                disabled: userPermissions.canEdit !== true || tableData.locks.deleteLocked,
              },
            ],
          }
        : { label: '…', terminal: true },
    ],
    [
      handleNavigateBack,
      userPermissions.canAdmin,
      userPermissions.canEdit,
      tableData,
      tableHeaderRename.editingId,
      tableHeaderRename.editValue,
      tableHeaderRename.setEditValue,
      tableHeaderRename.submitRename,
      tableHeaderRename.cancelRename,
      handleStartTableRename,
      onRequestDeleteTable,
    ]
  )

  // An admin can always reach the settings on a locked table — clearing locks
  // stays allowed with the flag off, so the kill switch can't strand one. With
  // the flag off and nothing locked there is nothing to change, so the toast is
  // a plain notice with no action.
  const canOpenLockSettings =
    userPermissions.canAdmin === true &&
    (tableLocksEnabled || (tableData ? lockedNouns(tableData.locks).length > 0 : false))

  /**
   * Explains why a table mutation is unavailable. A toast rather than a modal:
   * being told you can't edit shouldn't cost a dismiss click, and admins still
   * get a direct route to the settings via the action button.
   */
  const showBlockedToast = useCallback(
    (action: BlockedTableAction) => {
      if (!tableData) return
      if (blockedToastIdRef.current) toast.dismiss(blockedToastIdRef.current)
      const { title, text } = describeBlockedAction(action, tableData.locks)
      // 'status' is the on-open announcement — nothing was refused, so it reads
      // as information rather than a warning.
      const notify = action === 'status' ? toast.info : toast.warning
      blockedToastIdRef.current = notify(title, {
        description: text,
        ...(canOpenLockSettings
          ? {
              action: { label: 'Lock settings', onClick: () => setShowLockSettings(true) },
              // An action would otherwise pin the toast open until dismissed.
              duration: BLOCKED_TOAST_MS,
            }
          : {}),
      })
    },
    [tableData, canOpenLockSettings]
  )

  // Announce the lock state once per table on open. Unlike the re-rendering
  // permission gates, this fires once and can't self-correct, so it waits for
  // `canAdmin` to settle instead of treating loading as permitted.
  const announcedLockTableIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!tableData || userPermissions.isLoading) return
    if (announcedLockTableIdRef.current === tableData.id) return
    announcedLockTableIdRef.current = tableData.id
    if (lockedNouns(tableData.locks).length === 0) return
    showBlockedToast('status')
  }, [tableData, userPermissions.isLoading, showBlockedToast])

  // A notice must not outlive the table it describes — its action targets
  // whichever table is current. Keyed on `tableId` so an embedded swap that
  // changes the prop without a route change is covered too. Leaving ends the
  // visit, so the latch resets and coming back announces again.
  useEffect(
    () => () => {
      announcedLockTableIdRef.current = null
      if (!blockedToastIdRef.current) return
      toast.dismiss(blockedToastIdRef.current)
      blockedToastIdRef.current = null
    },
    [tableId]
  )

  // A toast's action is captured when it is created, so a viewer who loses
  // admin access mid-toast would keep a Lock settings button that opens
  // nothing. Dismiss on that transition only — a viewer who never had access
  // has a legitimate action-less notice that must survive.
  const couldOpenLockSettingsRef = useRef(canOpenLockSettings)
  useEffect(() => {
    const lostAccess = couldOpenLockSettingsRef.current && !canOpenLockSettings
    couldOpenLockSettingsRef.current = canOpenLockSettings
    if (!lostAccess || !blockedToastIdRef.current) return
    toast.dismiss(blockedToastIdRef.current)
    blockedToastIdRef.current = null
  }, [canOpenLockSettings])

  const headerActions = useMemo(() => {
    if (!tableData) return undefined
    return [
      {
        label: 'Import CSV',
        icon: Upload,
        onClick: onRequestImportCsv,
        // An import always inserts, so the insert lock disables it outright
        // rather than letting the dialog run to a server-side 423.
        disabled: userPermissions.canEdit !== true || tableData.locks.insertLocked,
      },
      {
        label: 'Export CSV',
        icon: Download,
        onClick: () => void handleExportCsv(),
        disabled: tableData.rowCount === 0,
      },
    ]
  }, [tableData, userPermissions.canEdit, handleExportCsv, onRequestImportCsv])

  // Adding a column is a schema change. The trigger stays visible when the
  // table is schema-locked and explains itself instead of disappearing.
  const canMutateSchema = userPermissions.canEdit && !tableData?.locks.schemaLocked
  const createTrigger = userPermissions.canEdit ? (
    <NewColumnDropdown
      trigger='header'
      disabled={false}
      blocked={!canMutateSchema}
      onBlocked={() => showBlockedToast('add-column')}
      onPickType={handleAddColumnOfType}
      onPickWorkflow={handleAddWorkflowColumn}
      onPickEnrichment={onOpenEnrichments}
    />
  ) : null

  const logPanelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const sidebarReservedPx =
    slideout.kind === 'column' || slideout.kind === 'workflow' || slideout.kind === 'enrichments'
      ? COLUMN_SIDEBAR_WIDTH
      : slideout.kind === 'execution' || slideout.kind === 'enrichment-details'
        ? logPanelWidth
        : 0

  const deleteTableMutation = useDeleteTable(workspaceId)
  const deleteRowsAsyncMutation = useDeleteTableRowsAsync({ workspaceId, tableId })
  const exportTableAsync = useExportTableAsync({ workspaceId, tableId })
  const handleDeleteTable = async () => {
    try {
      await deleteTableMutation.mutateAsync(tableId)
      setShowDeleteTableConfirm(false)
      router.push(`/workspace/${workspaceId}/tables`)
    } catch {
      setShowDeleteTableConfirm(false)
    }
  }

  const handleConfirmDeleteColumns = () => {
    if (!deletingColumns) return
    const names = deletingColumns
    setDeletingColumns(null)
    confirmDeleteColumnsSinkRef.current?.(names)
  }

  const columnConfig = slideout.kind === 'column' ? slideout.config : null
  const workflowConfig = slideout.kind === 'workflow' ? slideout.config : null
  const executionId = slideout.kind === 'execution' ? slideout.executionId : null
  const enrichmentDetailsTarget = slideout.kind === 'enrichment-details' ? slideout : null
  const enrichmentDetailsGroupName =
    enrichmentDetailsTarget &&
    tableWorkflowGroups.find((g) => g.id === enrichmentDetailsTarget.groupId)?.name
  // Fetch the workflow log when the execution-details slideout is open. Reuses
  // the logs page's <LogDetails> directly — no intermediate wrapper needed for
  // a one-line query forward.
  const { data: executionLog } = useLogByExecutionId(workspaceId, executionId)

  // Stable identity so the memoized Resource.Options can bail — an inline
  // object literal (with an inline arrow) would defeat its memo every render.
  const handleToggleFilter = useCallback(() => setFilterOpen((prev) => !prev), [])
  const filterConfig = useMemo(
    () => ({
      mode: 'toggle' as const,
      // The pruned filter, not the raw one: a condition the current schema
      // invalidated is not applied to the grid, so showing the chip as active
      // (and reopening that rule) would claim a filter the rows do not reflect.
      active: filterOpen || !!effectiveFilter,
      onToggle: handleToggleFilter,
    }),
    [filterOpen, effectiveFilter, handleToggleFilter]
  )

  const runStatus =
    embedded && (selection.totalRunning > 0 || selection.hasActiveDispatch) ? (
      <RunStatusControl
        running={selection.totalRunning}
        queueing={!selection.hasRunningCell}
        onStopAll={onStopAll}
        isStopping={cancelRunsMutation.isPending}
      />
    ) : null

  const saveViewChip =
    viewsEnabled && isViewDirty && userPermissions.canEdit ? (
      <Chip onClick={handleSaveView} disabled={updateViewMutation.isPending}>
        {activeView ? 'Save' : 'Save as view'}
      </Chip>
    ) : null

  /** Right-aligned slot. Left `undefined` when both are absent so the options bar
   *  doesn't render an empty flex row — a fragment would always read as truthy. */
  const optionsTrailing =
    runStatus || saveViewChip ? (
      <>
        {runStatus}
        {saveViewChip}
      </>
    ) : undefined

  return (
    <Resource>
      {!embedded && (
        <Resource.Header
          icon={TableIcon}
          breadcrumbs={breadcrumbs}
          aside={
            <div className='flex items-center gap-1.5'>
              <ImportProgressMenu workspaceId={workspaceId} tableId={tableId} />
              {selection.totalRunning > 0 || selection.hasActiveDispatch ? (
                <RunStatusControl
                  running={selection.totalRunning}
                  queueing={!selection.hasRunningCell}
                  onStopAll={onStopAll}
                  isStopping={cancelRunsMutation.isPending}
                />
              ) : null}
              {headerActions?.map((action) => (
                <Chip
                  key={action.label}
                  leftIcon={action.icon}
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.label}
                </Chip>
              ))}
              {createTrigger}
            </div>
          }
        />
      )}
      {/* Sort + filter render in both modes. In embedded (mothership) mode there's no
          Resource.Header, so the run/stop control rides in the options bar — pinned
          right, opposite the menu cluster, next to Save. */}
      <Resource.Options
        sort={sortConfig}
        filter={filterConfig}
        aside={
          viewsEnabled ? (
            <ViewsMenu
              views={views}
              activeViewId={activeView?.id ?? null}
              onSelect={handleSelectView}
              onRename={handleRenameView}
              onDelete={handleDeleteView}
              onNewView={handleNewView}
              canEdit={userPermissions.canEdit}
            />
          ) : undefined
        }
        asideEnd={
          viewsEnabled ? (
            <ColumnsMenu
              columns={columns}
              workflowGroups={tableWorkflowGroups}
              hiddenColumns={effectiveHiddenColumns}
              onChange={setHiddenColumns}
            />
          ) : undefined
        }
        trailing={optionsTrailing}
      />
      {filterOpen && (
        <TableFilter
          columns={columns}
          filter={effectiveFilter}
          onApply={handleFilterApply}
          onClose={() => setFilterOpen(false)}
        />
      )}
      <SaveViewModal
        open={viewsEnabled && (viewModal?.mode === 'create' || renamingView !== null)}
        onOpenChange={(open) => !open && setViewModal(null)}
        mode={viewModal?.mode === 'rename' ? 'rename' : viewModal?.blank ? 'new' : 'create'}
        initialName={renamingView?.name ?? ''}
        onSubmit={handleSubmitViewName}
        isSubmitting={createViewMutation.isPending || updateViewMutation.isPending}
      />
      <TableGrid
        workspaceId={workspaceId}
        tableId={tableId}
        embedded={embedded}
        locks={tableData?.locks}
        onBlockedAction={showBlockedToast}
        sidebarReservedPx={sidebarReservedPx}
        onOpenColumnConfig={onOpenColumnConfig}
        onOpenWorkflowConfig={onOpenWorkflowConfig}
        onOpenEnrichments={onOpenEnrichments}
        onOpenEnrichmentConfig={onOpenEnrichmentConfig}
        onOpenExecutionDetails={onOpenExecutionDetails}
        onOpenEnrichmentDetails={onOpenEnrichmentDetails}
        onOpenRowModal={onOpenRowModal}
        onRequestDeleteRows={onRequestDeleteRows}
        onRequestDeleteAllByFilter={onRequestDeleteAllByFilter}
        onRequestDeleteColumns={onRequestDeleteColumns}
        onRunColumn={onRunColumn}
        onRunRow={onRunRow}
        onRunRows={onRunRows}
        onStopRows={onStopRows}
        onStopAllRows={onStopAllRows}
        onStopRow={onStopRow}
        onSelectionChange={onSelectionChange}
        queryOptions={queryOptions}
        hiddenColumns={effectiveHiddenColumns}
        viewLayout={activeView?.config ?? null}
        viewLayoutKey={activeView?.id ?? null}
        // Always bound while views are enabled: the router reads the owner at
        // call time (buffer / view / All-metadata), so no binding gap can send a
        // write to the wrong place between settle and adoption.
        onPersistLayout={viewsEnabled ? handlePersistLayout : undefined}
        columnRenameSinkRef={columnRenameSinkRef}
        layoutSnapshotSinkRef={layoutSnapshotRef}
        afterDeleteRowsSinkRef={afterDeleteRowsSinkRef}
        afterDeleteAllSinkRef={afterDeleteAllSinkRef}
        confirmDeleteColumnsSinkRef={confirmDeleteColumnsSinkRef}
        pushTableRenameUndoSinkRef={pushTableRenameUndoSinkRef}
      />
      {userPermissions.canEdit && (
        <TableActionBar
          selectedCellCount={
            selection.selectedRunScope
              ? selection.selectedRunScope.groupIds.length * selection.selectedRunScope.rowCount
              : 0
          }
          runningCount={selection.runningInActionBarSelection}
          hasWorkflowColumns={selection.hasWorkflowColumns}
          showPlay={selection.selectionStats.hasIncompleteOrFailed}
          showRefresh={selection.selectionStats.hasCompleted}
          onPlay={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            runScope({
              groupIds: scope.groupIds,
              rowIds: scope.allRows ? undefined : scope.rowIds,
              // `filter`/`excludeRowIds` are only populated on select-all.
              filter: scope.filter,
              excludeRowIds: scope.excludeRowIds,
              runMode: 'incomplete',
              source: 'rows',
            })
          }}
          onRefresh={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            runScope({
              groupIds: scope.groupIds,
              rowIds: scope.allRows ? undefined : scope.rowIds,
              filter: scope.filter,
              excludeRowIds: scope.excludeRowIds,
              runMode: 'all',
              source: 'rows',
            })
          }}
          onStopWorkflows={() => {
            const scope = selection.selectedRunScope
            if (!scope) return
            if (scope.allRows) {
              scope.filter || scope.excludeRowIds?.length
                ? onStopAllRows(scope.filter, scope.excludeRowIds)
                : onStopAll()
            } else {
              onStopRows(scope.rowIds)
            }
          }}
          onViewExecution={
            selection.singleWorkflowCell?.canViewExecution &&
            selection.singleWorkflowCell.executionId
              ? () => {
                  const id = selection.singleWorkflowCell?.executionId
                  if (id) onOpenExecutionDetails(id)
                }
              : selection.singleWorkflowCell?.canViewEnrichment
                ? () => {
                    const cell = selection.singleWorkflowCell
                    if (cell) onOpenEnrichmentDetails(cell.rowId, cell.groupId)
                  }
                : undefined
          }
        />
      )}
      <ColumnConfigSidebar
        config={columnConfig}
        onClose={onCloseSlideout}
        existingColumn={
          columnConfig?.mode === 'edit'
            ? (columns.find((c) => getColumnId(c) === columnConfig.columnName) ?? null)
            : null
        }
        workspaceId={workspaceId}
        tableId={tableId}
        onColumnRename={onColumnRename}
      />
      <EnrichmentsSidebar
        open={slideout.kind === 'enrichments'}
        onClose={onCloseSlideout}
        allColumns={columns}
        workspaceId={workspaceId}
        tableId={tableId}
        editGroup={slideout.kind === 'enrichments' ? slideout.editGroup : undefined}
      />
      <WorkflowSidebar
        config={workflowConfig}
        onClose={onCloseSlideout}
        allColumns={columns}
        workflowGroups={tableWorkflowGroups}
        workflows={workflows}
        workspaceId={workspaceId}
        tableId={tableId}
        onColumnRename={onColumnRename}
      />
      <LogDetails
        log={executionLog ?? null}
        isOpen={Boolean(executionId)}
        onClose={onCloseSlideout}
      />
      <EnrichmentDetails
        tableId={tableId}
        rowId={enrichmentDetailsTarget?.rowId ?? null}
        groupId={enrichmentDetailsTarget?.groupId ?? null}
        groupName={enrichmentDetailsGroupName ?? undefined}
        isOpen={Boolean(enrichmentDetailsTarget)}
        onClose={onCloseSlideout}
      />
      {tableData && (
        <ImportCsvDialog
          open={isImportCsvOpen}
          onOpenChange={setIsImportCsvOpen}
          workspaceId={workspaceId}
          table={tableData}
        />
      )}
      {editingRow && tableData && (
        <RowModal
          mode='edit'
          isOpen={true}
          onClose={() => setEditingRow(null)}
          table={tableData}
          row={editingRow}
          onSuccess={() => setEditingRow(null)}
        />
      )}
      {deletingRows.length > 0 && tableData && (
        <RowModal
          mode='delete'
          isOpen={true}
          onClose={() => setDeletingRows([])}
          table={tableData}
          rowIds={deletingRows.map((r) => r.rowId)}
          onSuccess={() => {
            afterDeleteRowsSinkRef.current?.(deletingRows)
            setDeletingRows([])
          }}
        />
      )}
      <ChipConfirmModal
        open={deletingAll !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingAll(null)
        }}
        srTitle='Delete rows'
        title='Delete rows'
        text={`Delete ${deletingAll ? deletingAll.estimatedCount.toLocaleString() : 0} ${
          deletingAll?.estimatedCount === 1 ? 'row' : 'rows'
        }${effectiveFilter ? ' matching the current filter' : ''}? This can't be undone.`}
        confirm={{
          label: 'Delete',
          pending: deleteRowsAsyncMutation.isPending,
          pendingLabel: 'Deleting...',
          onClick: () => {
            if (!deletingAll) return
            const { excludeRowIds, estimatedCount } = deletingAll
            deleteRowsAsyncMutation.mutate({
              filter: effectiveFilter ?? undefined,
              sort: queryOptions.sort,
              excludeRowIds: excludeRowIds.length > 0 ? excludeRowIds : undefined,
              estimatedCount,
            })
            // Clear at click so the header checkbox doesn't linger in its
            // select-all state over the optimistically-emptied grid. If the
            // kickoff fails the rows visibly return with an error toast —
            // re-selecting is cheaper than a stale-looking selection.
            afterDeleteAllSinkRef.current?.()
            setDeletingAll(null)
          },
        }}
      />
      <ChipConfirmModal
        open={deletingColumns !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingColumns(null)
        }}
        srTitle={
          deletingColumns && deletingColumns.length > 1
            ? `Delete ${deletingColumns.length} Columns`
            : 'Delete Column'
        }
        title={
          deletingColumns && deletingColumns.length > 1
            ? `Delete ${deletingColumns.length} Columns`
            : 'Delete Column'
        }
        text={[
          'Are you sure you want to delete ',
          deletingColumns && deletingColumns.length > 1
            ? { text: `${deletingColumns.length} columns`, bold: true }
            : {
                text:
                  (deletingColumns &&
                    columns.find((c) => getColumnId(c) === deletingColumns[0])?.name) ??
                  deletingColumns?.[0] ??
                  'this column',
                bold: true,
              },
          '? ',
          {
            text: `This will remove all data in ${deletingColumns && deletingColumns.length > 1 ? 'these columns' : 'this column'}.`,
            error: true,
          },
          ' You can undo this action.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleConfirmDeleteColumns,
        }}
      />
      {!embedded && (
        <ChipConfirmModal
          open={showDeleteTableConfirm}
          onOpenChange={setShowDeleteTableConfirm}
          srTitle='Delete Table'
          title='Delete Table'
          text={[
            'Are you sure you want to delete ',
            { text: tableData?.name ?? 'this table', bold: true },
            '? ',
            { text: `All ${tableData?.rowCount ?? 0} rows will be removed.`, error: true },
            ' You can restore it from Recently Deleted in Settings.',
          ]}
          confirm={{
            label: 'Delete',
            onClick: handleDeleteTable,
            pending: deleteTableMutation.isPending,
            pendingLabel: 'Deleting...',
          }}
        />
      )}
      {tableData && userPermissions.canAdmin && (
        <LockSettingsModal
          isOpen={showLockSettings}
          onClose={() => setShowLockSettings(false)}
          workspaceId={workspaceId}
          tableId={tableData.id}
          locks={tableData.locks}
        />
      )}
    </Resource>
  )
}
