import type {
  BreadcrumbEditing,
  BreadcrumbItem,
  DropdownOption,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import type { WorkflowFolder } from '@/stores/folders/types'

export interface FolderBreadcrumbItemsOptions {
  /** Root crumb label — the page's own name ("Knowledge Base", "Tables"). */
  rootLabel: string
  rootIcon?: React.ElementType
  /** Root-first ancestor chain of the open folder, from `useFolderNavigation`. */
  breadcrumbs: WorkflowFolder[]
  /** Called with the folder to open, or `null` for the workspace root. */
  onNavigate: (folderId: string | null) => void
  /** Menu attached to the open folder's crumb (rename, delete, …). */
  currentFolderActions?: DropdownOption[]
  /** Inline rename bound to the open folder's crumb. */
  currentFolderEditing?: BreadcrumbEditing
}

/**
 * Converts a folder ancestor chain into the `BreadcrumbItem[]` that `Resource.Header`
 * renders.
 *
 * A plain builder rather than a component: `Resource.Header` already owns every piece of
 * breadcrumb chrome — the root-crumb "Path" popover, segment width allocation, overflow
 * tooltips, and the rule that a single-element trail renders as a plain page title. A
 * sibling crumb component would have to fork all of it, which is exactly what this shared
 * directory exists to prevent.
 *
 * The trail always starts with the root crumb, so at the workspace root the result has
 * length 1 and the header renders the page title unchanged.
 */
export function folderBreadcrumbItems({
  rootLabel,
  rootIcon,
  breadcrumbs,
  onNavigate,
  currentFolderActions,
  currentFolderEditing,
}: FolderBreadcrumbItemsOptions): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    { label: rootLabel, icon: rootIcon, onClick: () => onNavigate(null) },
  ]

  breadcrumbs.forEach((folder, index) => {
    const isCurrent = index === breadcrumbs.length - 1
    items.push({
      label: folder.name,
      // The current folder is where you already are, so its crumb is not a navigation
      // target — it carries the folder's own actions instead.
      onClick: isCurrent ? undefined : () => onNavigate(folder.id),
      dropdownItems: isCurrent && currentFolderActions?.length ? currentFolderActions : undefined,
      editing: isCurrent ? currentFolderEditing : undefined,
    })
  })

  return items
}
