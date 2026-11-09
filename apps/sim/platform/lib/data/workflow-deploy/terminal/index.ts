/**
 * The editor Terminal's logic seam. The ported terminal reads the legacy console store (IndexedDB
 * backed), its persisted layout preferences, the execution-tree grouping and filter hook, and the
 * code viewer's search state unchanged; only the views are rebuilt in the zone.
 */

export { useTerminalFilters } from '@/components/workflow-editor/components/terminal/hooks/use-terminal-filters'
export {
  collectExpandableNodeIds,
  type EntryNode,
  type ExecutionGroup,
  flattenBlockEntriesOnly,
  flattenVisibleExecutionRows,
  getBlockColor,
  getBlockIcon,
  groupEntriesByExecution,
  isEventFromEditableElement,
  type NavigableBlockEntry,
  TERMINAL_CONFIG,
  type VisibleTerminalRow,
} from '@/components/workflow-editor/components/terminal/utils'
export { isUserFileDisplayMetadata } from '@/lib/core/utils/user-file'
export type { LargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
export { isLargeArrayManifest } from '@/lib/execution/payloads/large-array-manifest-metadata'
export type { LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
export { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
export { useCodeViewerFeatures } from '@/hooks/use-code-viewer'
export { isMobileViewport } from '@/hooks/use-is-mobile'
export { OUTPUT_PANEL_WIDTH } from '@/stores/constants'
export type { ConsoleEntry } from '@/stores/terminal'
export {
  safeConsoleStringify,
  useConsoleEntry,
  useTerminalConsoleStore,
  useTerminalStore,
  useWorkflowConsoleEntries,
} from '@/stores/terminal'
