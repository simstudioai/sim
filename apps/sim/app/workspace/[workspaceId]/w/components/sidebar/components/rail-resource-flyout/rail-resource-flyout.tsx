'use client'

/**
 * Rail flyout bodies for the foldered workspace resources.
 *
 * Both flyouts mount only while their rail menu is open — Radix does not force-mount menu
 * content — which is the whole reason they own their queries instead of the sidebar. A hook
 * on the sidebar stays subscribed to its cache key on every workspace route even with
 * `enabled: false`, so an unrelated writer (the table-import poller ticks every 2s) would
 * re-render the entire sidebar to feed a flyout nobody has opened.
 */

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  buildFlyoutEntries,
  FOLDERED_RESOURCE_HEADERS,
} from '@/app/workspace/[workspaceId]/components/folders'
import { CollapsedResourceFlyout } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu'
import { useFolders } from '@/hooks/queries/folders'
import { usePinnedIds } from '@/hooks/queries/pinned-items'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkspaceFileFolders } from '@/hooks/queries/workspace-file-folders'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

const TABLE_META = FOLDERED_RESOURCE_HEADERS.table
const FILE_META = FOLDERED_RESOURCE_HEADERS.file

/**
 * A list is usable only once it has resolved for THIS workspace. Every list here keeps the
 * previous workspace's rows as placeholder data across a switch, and a tree built from one
 * workspace's resources against another's folders resolves no folder id at all — which the
 * builder reads as "archived out from under it" and files the whole list at the root. So the
 * rows wait for both queries rather than render a shape that is wrong and then jumps.
 *
 * `isPlaceholderData` is what separates that from a real result; a pending-only check is the
 * exact gate `tables.tsx` warns against. An error settles a query without resolving it, and is
 * deliberately not held here: the flyout then renders flat, which still reaches every row.
 */
function isResolving(query: { isPending: boolean; isPlaceholderData: boolean }): boolean {
  return query.isPending || query.isPlaceholderData
}

export function TablesRailFlyout({ workspaceId }: { workspaceId: string }) {
  const params = useParams()
  const tablesQuery = useTablesList(workspaceId)
  const foldersQuery = useFolders(workspaceId, { resourceType: 'table' })
  const pinnedTableIds = usePinnedIds(workspaceId, 'table')
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')
  const { data: tables } = tablesQuery
  const { data: folders } = foldersQuery

  const entries = useMemo(
    () =>
      buildFlyoutEntries({
        folders: folders ?? [],
        items: tables ?? [],
        pinnedFolderIds,
        pinnedItemIds: pinnedTableIds,
        hrefForItem: (table) => `/workspace/${workspaceId}/${TABLE_META.listSegment}/${table.id}`,
      }),
    [folders, tables, pinnedFolderIds, pinnedTableIds, workspaceId]
  )

  return (
    <CollapsedResourceFlyout
      entries={entries}
      currentItemId={typeof params.tableId === 'string' ? params.tableId : undefined}
      isLoading={isResolving(tablesQuery) || isResolving(foldersQuery)}
      emptyLabel='No tables yet'
    />
  )
}

export function FilesRailFlyout({ workspaceId }: { workspaceId: string }) {
  const params = useParams()
  const filesQuery = useWorkspaceFiles(workspaceId)
  const foldersQuery = useWorkspaceFileFolders(workspaceId)
  const pinnedFileIds = usePinnedIds(workspaceId, 'file')
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')
  const { data: files } = filesQuery
  const { data: folders } = foldersQuery

  const entries = useMemo(
    () =>
      buildFlyoutEntries({
        folders: folders ?? [],
        items: files ?? [],
        pinnedFolderIds,
        pinnedItemIds: pinnedFileIds,
        hrefForItem: (file) => `/workspace/${workspaceId}/${FILE_META.listSegment}/${file.id}`,
      }),
    [folders, files, pinnedFolderIds, pinnedFileIds, workspaceId]
  )

  return (
    <CollapsedResourceFlyout
      entries={entries}
      currentItemId={typeof params.fileId === 'string' ? params.fileId : undefined}
      isLoading={isResolving(filesQuery) || isResolving(foldersQuery)}
      emptyLabel='No files yet'
    />
  )
}
