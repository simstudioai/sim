import { Folder } from '@sim/emcn/icons'
import { folderRowId } from '@/app/workspace/[workspaceId]/components/folders/folder-row-id'
import type {
  ResourceCell,
  ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import type { WorkflowFolder } from '@/stores/folders/types'

const FOLDER_ICON = <Folder className='size-[14px]' />

export interface FolderRowOptions {
  /**
   * Whether this folder is pinned. Folders pin under `resourceType: 'folder'`, a different
   * pin namespace from the resource they contain — a page listing both resolves two
   * `usePinnedIds` sets and passes the right one here. Drives the glyph only; the pin action
   * lives on the row's context menu.
   */
  pinned?: boolean
  /**
   * Cells for the page's non-name columns, keyed by `ResourceColumn.id`. Folders have no
   * value for most resource-specific columns, so a page passes either a derived roll-up or
   * the em-dash placeholder.
   */
  cells?: Record<string, ResourceCell>
  /** Column id carrying the name cell. Defaults to `'name'`. */
  nameColumnId?: string
}

/**
 * Builds the canonical folder `ResourceRow` shared by every foldered list, so a folder looks
 * and behaves identically on Knowledge, Tables, and Files. The row id is namespaced by
 * {@link folderRowId}, so the caller's click/context-menu handlers distinguish a folder from
 * a resource with `parseFolderedRowId` rather than a second lookup.
 *
 * Pinning is not a cell: it lives in the row's context menu (see `FolderContextMenu`), and
 * inline rename is layered over the built rows by the page so a keystroke in the rename
 * field rebuilds one cell instead of every row's cells.
 */
export function folderRow(folder: WorkflowFolder, options: FolderRowOptions = {}): ResourceRow {
  const { pinned, cells, nameColumnId = 'name' } = options

  return {
    id: folderRowId(folder.id),
    cells: {
      ...cells,
      [nameColumnId]: {
        icon: FOLDER_ICON,
        label: folder.name,
        pinned,
      },
    },
  }
}
