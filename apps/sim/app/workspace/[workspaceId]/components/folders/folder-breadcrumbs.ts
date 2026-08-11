import type { ElementType } from 'react'
import { folderAncestorChain } from '@/lib/folders/tree'
import type {
  BreadcrumbEditing,
  BreadcrumbItem,
  DropdownOption,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'

/**
 * The only thing a breadcrumb trail needs from a folder tree node. Structural rather than
 * `WorkflowFolder` so the Files tree builds its trail through this same code path instead of
 * forking one: file folders live in the same `folder` table, but they are served by their own
 * routes and carry their own row type (see the `servedFolderResourceTypeSchema` docs in
 * `@/lib/api/contracts/folders` for why that split exists and is staying).
 */
export interface BreadcrumbFolder {
  id: string
  name: string
  parentId: string | null
}

/**
 * Root-first ancestor chain for a breadcrumb trail, that folder last. Empty at the workspace
 * root — and empty for a chain that does not reach the root, where {@link folderAncestorChain}
 * would hand back the part it walked.
 *
 * A header falls back to the root title rather than rendering a trail that silently skips a
 * level: a partial path is not a shorter path, it is a wrong one, claiming the deepest folder
 * it resolved sits at the workspace root. A chain is complete exactly when its first element
 * has no parent, which also rejects a cycle (the DB permits one between constraint checks).
 *
 * `folderById` must therefore be the complete tree — see `FolderAncestors.foldersResolved`;
 * a partially loaded map reads as an orphan and collapses.
 */
export function breadcrumbFolderChain<T extends BreadcrumbFolder>(
  folderId: string | null | undefined,
  folderById: ReadonlyMap<string, T>
): T[] {
  const chain = folderAncestorChain(folderId, (id) => folderById.get(id))
  return chain.length === 0 || chain[0].parentId === null ? chain : EMPTY_CHAIN
}

const EMPTY_CHAIN: never[] = []

interface FolderBreadcrumbItemsBase {
  /** Root crumb label — the page's own name ("Knowledge Base", "Tables"). */
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
 * Converts a folder ancestor chain into the `BreadcrumbItem[]` that `Resource.Header`
 * renders, for a list page (`Tables / Reports`) or a detail page (`Tables / Reports / Q3`).
 *
 * A plain builder rather than a component: `Resource.Header` already owns every piece of
 * breadcrumb chrome — the root-crumb "Path" popover, segment width allocation, overflow
 * tooltips, and the rule that a single-element trail renders as a plain page title. A
 * sibling crumb component would have to fork all of it, which is exactly what this shared
 * directory exists to prevent.
 *
 * The trail always starts with the root crumb, so a list page at the workspace root returns
 * length 1 and the header renders the page title unchanged.
 */
export function folderBreadcrumbItems(options: FolderBreadcrumbItemsOptions): BreadcrumbItem[] {
  const { rootLabel, rootIcon, breadcrumbs, onNavigate } = options
  const trailing = options.trailing ?? NO_TRAILING_CRUMBS

  const items: BreadcrumbItem[] = [
    { label: rootLabel, icon: rootIcon, onClick: () => onNavigate(null) },
  ]

  breadcrumbs.forEach((folder, index) => {
    /** Where you already are — and on a detail page that is a trailing crumb, not a folder. */
    const isOpenFolder = trailing.length === 0 && index === breadcrumbs.length - 1
    items.push({
      label: folder.name,
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
