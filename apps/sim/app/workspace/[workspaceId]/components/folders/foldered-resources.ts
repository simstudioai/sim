import type { ComponentType } from 'react'
import { Database, File as FileIcon, Table as TableIcon } from '@sim/emcn/icons'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { folderListHref } from '@/app/workspace/[workspaceId]/components/folders/search-params'

/**
 * The foldered resources that render a `Resource.Header` breadcrumb trail. A subset of
 * {@link FolderResourceType}: workflows are foldered too, but they live in the editor sidebar
 * rather than on a list page with a header.
 */
export type FolderedHeaderResourceType = Extract<
  FolderResourceType,
  'file' | 'knowledge_base' | 'table'
>

export interface FolderedResourceHeaderMeta {
  /** Root crumb label, and the page title at the workspace root. */
  rootLabel: string
  /** Icon on the root crumb, which is also what opens the header's "Path" popover. */
  rootIcon: ComponentType<{ className?: string }>
  /** Path segment of the list page under `/workspace/[workspaceId]/`. */
  listSegment: string
}

/**
 * The per-resource facts a foldered header needs, in one place.
 *
 * Each was previously restated at every surface rendering that resource — list page, detail
 * page, and for knowledge bases the document and chunk views — which is how one trail ends up
 * labelled differently depending on which page you reached it from.
 */
export const FOLDERED_RESOURCE_HEADERS: Record<
  FolderedHeaderResourceType,
  FolderedResourceHeaderMeta
> = {
  file: { rootLabel: 'Files', rootIcon: FileIcon, listSegment: 'files' },
  knowledge_base: { rootLabel: 'Knowledge bases', rootIcon: Database, listSegment: 'knowledge' },
  table: { rootLabel: 'Tables', rootIcon: TableIcon, listSegment: 'tables' },
}

/**
 * Href of a foldered resource's list page, opened at `folderId` or at its workspace root.
 *
 * Detail pages navigate to a different route, so their breadcrumb folder crumbs cannot use the
 * nuqs setter — it only mutates the query of the current path.
 */
export function folderedResourceListHref(
  resourceType: FolderedHeaderResourceType,
  workspaceId: string,
  folderId: string | null
): string {
  const { listSegment } = FOLDERED_RESOURCE_HEADERS[resourceType]
  return folderListHref(`/workspace/${workspaceId}/${listSegment}`, folderId)
}
