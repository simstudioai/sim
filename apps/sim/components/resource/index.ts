/**
 * The shared resource-page chrome: the `Resource` compound shell (header,
 * options toolbar, data table) and the cell/column primitives its consumers
 * build rows from.
 *
 * It lives under `components/` rather than the workspace route tree because it
 * has consumers on both sides of that tree — the workspace pages (files,
 * knowledge, tables, logs) and the canonical resource views under
 * `components/resources/**`, which may not import
 * `@/app/workspace/[workspaceId]/**`.
 */
export { FloatingOverflowText } from './components/floating-overflow-text'
export { type MemberFilterOption, memberFilterOptions, ownerCell } from './components/owner-cell'
export {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from './components/resource-chrome-fallback'
export type {
  BreadcrumbEditing,
  BreadcrumbItem,
  DropdownOption,
  ResourceAction,
} from './components/resource-header'
export type {
  ColumnOption,
  FilterConfig,
  FilterTag,
  SearchConfig,
  SearchTag,
  SortConfig,
} from './components/resource-options'
export { SortDropdown } from './components/resource-options'
export { timeCell } from './components/time-cell'
export type {
  PaginationConfig,
  ResourceCell,
  ResourceCellEditing,
  ResourceColumn,
  ResourceRow,
  ResourceTableHandle,
  RowDragDropConfig,
  SelectableConfig,
} from './resource'
export { EMPTY_CELL_PLACEHOLDER, Resource } from './resource'
export { useBackgroundContextMenu } from './use-background-context-menu'
