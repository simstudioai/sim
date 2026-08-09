'use client'

import { memo, useMemo, useState } from 'react'
import { chipContentIconClass, cn, disclosureChevronClass } from '@sim/emcn'
import { ChevronRight, File, Folder, FolderOpen } from '@sim/emcn/icons'
import Link from 'next/link'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileFolderApi } from '@/hooks/queries/workspace-file-folders'

type FileTreeNode =
  | { kind: 'folder'; id: string; name: string; children: FileTreeNode[] }
  | { kind: 'file'; id: string; name: string; file: WorkspaceFileRecord }

/**
 * Nests folders and files into one tree, ordering each level by name with
 * folders and files interleaved. A folder is not hoisted above the file beside
 * it — the Files page sorts them as one list, and a sidebar that partitioned
 * them would order the same folder's contents differently from the page.
 */
function buildFileTree(
  folders: WorkspaceFileFolderApi[],
  files: WorkspaceFileRecord[],
  parentId: string | null = null
): FileTreeNode[] {
  const nodes: FileTreeNode[] = [
    ...folders
      .filter((folder) => (folder.parentId ?? null) === parentId)
      .map(
        (folder): FileTreeNode => ({
          kind: 'folder',
          id: folder.id,
          name: folder.name,
          children: buildFileTree(folders, files, folder.id),
        })
      ),
    ...files
      .filter((file) => (file.folderId ?? null) === parentId)
      .map((file): FileTreeNode => ({ kind: 'file', id: file.id, name: file.name, file })),
  ]
  return nodes.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

const INDENT_PER_LEVEL = 16

/**
 * A file row has no chevron, so it indents past where a folder row's would be —
 * the chevron's own width plus the row's `gap-1` — putting the two rows' icons on
 * the same x. Keep in step with `disclosureChevronClass` (14px) and the row gap.
 */
const CHEVRON_LEADING_WIDTH = 14 + 4

interface FileTreeNodeItemProps {
  node: FileTreeNode
  workspaceId: string
  currentFileId: string | undefined
  pathname: string | null
  level: number
}

const FileTreeNodeItem = memo(function FileTreeNodeItem({
  node,
  workspaceId,
  currentFileId,
  pathname,
  level,
}: FileTreeNodeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  if (node.kind === 'file') {
    const href = `/workspace/${workspaceId}/files/${node.file.id}`
    const isActive = currentFileId === node.file.id || pathname === href
    return (
      <Link
        href={href}
        className={cn(
          'group mx-0.5 flex h-[30px] items-center gap-1 rounded-lg text-sm',
          !isActive && 'hover-hover:bg-[var(--surface-hover)]',
          isActive && 'bg-[var(--surface-active)]'
        )}
        style={{ paddingLeft: `${8 + level * INDENT_PER_LEVEL + CHEVRON_LEADING_WIDTH}px` }}
      >
        <File className={chipContentIconClass} aria-hidden='true' />
        <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>{node.name}</span>
      </Link>
    )
  }

  const hasChildren = node.children.length > 0

  return (
    <div>
      <button
        type='button'
        className='group mx-0.5 flex h-[30px] w-[calc(100%-4px)] items-center gap-1 rounded-lg px-2 text-sm hover-hover:bg-[var(--surface-hover)]'
        style={{ paddingLeft: `${8 + level * INDENT_PER_LEVEL}px` }}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <ChevronRight
          className={cn(
            disclosureChevronClass,
            isExpanded && hasChildren && 'rotate-90',
            !hasChildren && 'opacity-0'
          )}
          aria-hidden='true'
        />
        {isExpanded && hasChildren ? (
          <FolderOpen className={chipContentIconClass} aria-hidden='true' />
        ) : (
          <Folder className={chipContentIconClass} aria-hidden='true' />
        )}
        <span className='min-w-0 flex-1 truncate text-left text-[var(--text-body)]'>
          {node.name}
        </span>
      </button>

      {isExpanded &&
        node.children.map((child) => (
          <FileTreeNodeItem
            key={child.id}
            node={child}
            workspaceId={workspaceId}
            currentFileId={currentFileId}
            pathname={pathname}
            level={level + 1}
          />
        ))}
    </div>
  )
})

interface FileListProps {
  workspaceId: string
  currentFileId?: string
  pathname: string | null
  folders: WorkspaceFileFolderApi[]
  files: WorkspaceFileRecord[]
}

export const FileList = memo(function FileList({
  workspaceId,
  currentFileId,
  pathname,
  folders,
  files,
}: FileListProps) {
  const rootNodes = useMemo(() => buildFileTree(folders, files, null), [folders, files])

  return (
    <div className='flex flex-col'>
      {rootNodes.map((node) => (
        <FileTreeNodeItem
          key={node.id}
          node={node}
          workspaceId={workspaceId}
          currentFileId={currentFileId}
          pathname={pathname}
          level={0}
        />
      ))}
    </div>
  )
})
