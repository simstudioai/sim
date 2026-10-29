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
import { DropdownMenuItem } from '@sim/emcn'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  buildFlyoutEntries,
  FOLDERED_RESOURCE_HEADERS,
  folderedResourceListHref,
} from '@/app/workspace/[workspaceId]/components/folders'
import { CollapsedResourceFlyout } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu'
import { useFolders } from '@/hooks/queries/folders'
import { usePinnedIds } from '@/hooks/queries/pinned-items'
import { usePinnedWorkspaceFiles } from '@/hooks/queries/pinned-workspace-files'
import { useTablesList } from '@/hooks/queries/tables'
import { workspaceFileListParams } from '@/hooks/queries/utils/workspace-file-keys'
import {
  useWorkspaceFileFolders,
  type WorkspaceFileFolderApi,
} from '@/hooks/queries/workspace-file-folders'
import {
  distinctFiles,
  useWorkspaceFileFolderSizes,
  useWorkspaceFileList,
} from '@/hooks/queries/workspace-files'

const TABLE_META = FOLDERED_RESOURCE_HEADERS.table
const FILE_META = FOLDERED_RESOURCE_HEADERS.file

const EMPTY_FILE_FOLDERS: WorkspaceFileFolderApi[] = []

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

/** How many of a folder's files the flyout lists before linking to the rest in Files. */
const FILE_FLYOUT_PAGE_SIZE = 50

interface FilesFlyoutLevelProps {
  workspaceId: string
  /** The folder this level lists, `null` for the root. */
  folderId: string | null
  folders: readonly WorkspaceFileFolderApi[]
  foldersResolved: boolean
  currentItemId?: string
}

/**
 * One level of the Files flyout: the folder's subfolders and its most recently updated files,
 * fetched when the level opens rather than the workspace's whole file list. A folder's submenu is
 * the same component one level down, mounted only when it opens. A level with more files than it
 * lists ends in a link to the folder in Files.
 */
function FilesFlyoutLevel({
  workspaceId,
  folderId,
  folders,
  foldersResolved,
  currentItemId,
}: FilesFlyoutLevelProps) {
  const fileList = useWorkspaceFileList(
    workspaceId,
    workspaceFileListParams({
      folderId,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      limit: FILE_FLYOUT_PAGE_SIZE,
    })
  )
  const folderStats = useWorkspaceFileFolderSizes(workspaceId, [folderId])
  const { files: pinnedFiles, pinnedFileIds } = usePinnedWorkspaceFiles(workspaceId, folderId)
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')

  const entries = useMemo(() => {
    const files = distinctFiles([pinnedFiles, fileList.data?.files])
    return buildFlyoutEntries({
      folders: folders
        .filter((folder) => (folder.parentId ?? null) === folderId)
        .map((folder) => ({ ...folder, parentId: null })),
      items: files.map((file) => ({ ...file, folderId: null })),
      pinnedFolderIds,
      pinnedItemIds: pinnedFileIds,
      hrefForItem: (file) => `/workspace/${workspaceId}/${FILE_META.listSegment}/${file.id}`,
    })
  }, [fileList.data, folders, folderId, pinnedFiles, pinnedFileIds, pinnedFolderIds, workspaceId])

  /** The folders that have subfolders, indexed once for the per-folder emptiness check. */
  const parentsWithSubfolders = useMemo(
    () => new Set(folders.map((folder) => folder.parentId)),
    [folders]
  )

  return (
    <CollapsedResourceFlyout
      entries={entries}
      currentItemId={currentItemId}
      isLoading={isResolving(fileList) || !foldersResolved}
      emptyLabel={folderId ? 'No files in this folder' : 'No files yet'}
      lazyFolders={{
        isEmpty: (id) => !parentsWithSubfolders.has(id) && folderStats.get(id)?.fileCount === 0,
        render: (id) => (
          <FilesFlyoutLevel
            workspaceId={workspaceId}
            folderId={id}
            folders={folders}
            foldersResolved={foldersResolved}
            currentItemId={currentItemId}
          />
        ),
      }}
      footer={
        fileList.hasNextPage ? (
          <DropdownMenuItem asChild>
            <Link href={folderedResourceListHref('file', workspaceId, folderId)}>
              Show all in Files
            </Link>
          </DropdownMenuItem>
        ) : null
      }
    />
  )
}

export function FilesRailFlyout({ workspaceId }: { workspaceId: string }) {
  const params = useParams()
  const foldersQuery = useWorkspaceFileFolders(workspaceId)
  return (
    <FilesFlyoutLevel
      workspaceId={workspaceId}
      folderId={null}
      folders={foldersQuery.data ?? EMPTY_FILE_FOLDERS}
      foldersResolved={!isResolving(foldersQuery)}
      currentItemId={typeof params.fileId === 'string' ? params.fileId : undefined}
    />
  )
}
