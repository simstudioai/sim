import type { ElementType } from 'react'
import { folderAncestorChain } from '@/lib/folders/tree'
import type {
  BreadcrumbEditing,
  BreadcrumbItem,
  DropdownOption,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'

/**
 * Structural rather than `WorkflowFolder` so the Files tree — same `folder` table, own routes
 * and row type (see `servedFolderResourceTypeSchema` in `@/lib/api/contracts/folders`) — shares
 * this code path instead of forking it.
 */
export interface BreadcrumbFolder {
  id: string
  name: string
  parentId: string | null
}

const EMPTY_CHAIN: never[] = []

/**
 * Root-first ancestor chain, that folder last, or empty when it does not reach the root —
 * where {@link folderAncestorChain} would hand back the part it walked.
 *
 * A partial path is not a shorter path, it is a wrong one: it claims the deepest folder it
 * resolved sits at the workspace root. Falling back to the root title is the honest render.
 * Completeness is `chain[0].parentId === null`, which also rejects a cycle. Callers must pass
 * the complete tree — see `FolderAncestors.foldersResolved`.
 */
export function breadcrumbFolderChain<T extends BreadcrumbFolder>(
  folderId: string | null | undefined,
  folderById: ReadonlyMap<string, T>
): T[] {
  const chain = folderAncestorChain(folderId, (id) => folderById.get(id))
  return chain.length === 0 || chain[0].parentId === null ? chain : EMPTY_CHAIN
}

interface FolderBreadcrumbItemsBase {
  /** Root crumb label — the page's own name ("Knowledge bases", "Tables"). */
  rootLabel: string
  rootIcon?: ElementType
  /** Root-first ancestor chain, from {@link folderAncestorChain}. */
  breadcrumbs: BreadcrumbFolder[]
  /** Called with the folder to open, or `null` for the workspace root. */
  onNavigate: (folderId: string | null) => void
}

/** A list page: the deepest folder is where you are, so its crumb carries the rename and menu. */
interface FolderListBreadcrumbOptions extends FolderBreadcrumbItemsBase {
  /** Menu attached to the open folder's crumb (rename, delete, …). */
  currentFolderActions?: DropdownOption[]
  /** Inline rename bound to the open folder's crumb. */
  currentFolderEditing?: BreadcrumbEditing
  trailing?: never
}

/** A detail page: the open resource is where you are, so every folder crumb navigates. */
interface FolderDetailBreadcrumbOptions extends FolderBreadcrumbItemsBase {
  /**
   * Crumbs appended after the folder trail — the resource open on a detail page, plus
   * anything nested under it (a knowledge base's document, that document's chunk).
   */
  trailing: BreadcrumbItem[]
  currentFolderActions?: never
  currentFolderEditing?: never
}

/**
 * The two modes are disjoint by construction rather than by convention: an open-folder rename
 * or menu acts on the folder you are inside, which on a detail page you are not. Expressed as
 * a union so passing both is a compile error instead of a handler that silently never fires.
 */
export type FolderBreadcrumbItemsOptions =
  | FolderListBreadcrumbOptions
  | FolderDetailBreadcrumbOptions

const NO_TRAILING_CRUMBS: BreadcrumbItem[] = []

/**
 * Builds the `BreadcrumbItem[]` for a list page (`Tables / Reports`) or a detail page
 * (`Tables / Reports / Q3`).
 *
 * A plain builder rather than a component: `Resource.Header` already owns every piece of
 * breadcrumb chrome — the root-crumb "Path" popover, segment width allocation, overflow
 * tooltips, and the rule that a single-element trail renders as a plain page title. A sibling
 * crumb component would have to fork all of it, which is what this directory exists to prevent.
 */
export function folderBreadcrumbItems(options: FolderBreadcrumbItemsOptions): BreadcrumbItem[] {
  const { rootLabel, rootIcon, breadcrumbs, onNavigate } = options
  const trailing = options.trailing ?? NO_TRAILING_CRUMBS

  const items: BreadcrumbItem[] = [
    { label: rootLabel, icon: rootIcon, folderId: null, onClick: () => onNavigate(null) },
  ]

  breadcrumbs.forEach((folder, index) => {
    /** Where you already are — and on a detail page that is a trailing crumb, not a folder. */
    const isOpenFolder = trailing.length === 0 && index === breadcrumbs.length - 1
    items.push({
      label: folder.name,
      folderId: folder.id,
      onClick: isOpenFolder ? undefined : () => onNavigate(folder.id),
      dropdownItems:
        isOpenFolder && options.currentFolderActions?.length
          ? options.currentFolderActions
          : undefined,
      editing: isOpenFolder ? options.currentFolderEditing : undefined,
    })
  })

  items.push(...trailing)

  return items
}
