/**
 * `Resource` and `InlineRenameInput` are re-exported from `@/components/**`:
 * they moved out of this tree because the canonical resource views under
 * `components/resources/**` mount them too, and a shared unit may not import
 * `@/app/workspace/[workspaceId]/**`. The workspace tree keeps reaching them
 * through this barrel, which stays its single aggregated entry point.
 */
export { InlineRenameInput } from '@/components/inline-rename-input'
export {
  type BreadcrumbEditing,
  type BreadcrumbItem,
  type ChromeActionSpec,
  type ColumnOption,
  type DropdownOption,
  EMPTY_CELL_PLACEHOLDER,
  type FilterConfig,
  type FilterTag,
  FloatingOverflowText,
  type MemberFilterOption,
  memberFilterOptions,
  ownerCell,
  type PaginationConfig,
  Resource,
  type ResourceAction,
  type ResourceCell,
  type ResourceCellEditing,
  ResourceChromeFallback,
  type ResourceColumn,
  type ResourceRow,
  type ResourceTableHandle,
  type RowDragDropConfig,
  type SearchConfig,
  type SearchTag,
  type SelectableConfig,
  type SortConfig,
  SortDropdown,
  timeCell,
  useBackgroundContextMenu,
} from '@/components/resource'
export { ConversationListItem } from './conversation-list-item'
export type { ErrorBoundaryProps, ErrorStateProps } from './error'
export { ErrorShell, ErrorState } from './error'
export { IntegrationTabsHeader } from './integration-tabs-header'
export { MessageActions } from './message-actions'
export { ResourceTile } from './resource-tile'
export { ShareModal, type ShareModalProps } from './share-modal'
export { SkillTile } from './skill-tile'
