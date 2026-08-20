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

export function TablesRailFlyout({ workspaceId }: { workspaceId: string }) {
  const params = useParams()
  const { data: tables, isPending: isTablesPending } = useTablesList(workspaceId)
  const { data: folders, isPending: isFoldersPending } = useFolders(workspaceId, {
    resourceType: 'table',
  })
  const pinnedTableIds = usePinnedIds(workspaceId, 'table')
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')

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
      icon={TABLE_META.rootIcon}
      currentItemId={typeof params.tableId === 'string' ? params.tableId : undefined}
      isLoading={isTablesPending || isFoldersPending}
      emptyLabel='No tables yet'
    />
  )
}

export function FilesRailFlyout({ workspaceId }: { workspaceId: string }) {
  const params = useParams()
  const { data: files, isPending: isFilesPending } = useWorkspaceFiles(workspaceId)
  const { data: folders, isPending: isFoldersPending } = useWorkspaceFileFolders(workspaceId)
  const pinnedFileIds = usePinnedIds(workspaceId, 'file')
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')

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
      icon={FILE_META.rootIcon}
      currentItemId={typeof params.fileId === 'string' ? params.fileId : undefined}
      isLoading={isFilesPending || isFoldersPending}
      emptyLabel='No files yet'
    />
  )
}
