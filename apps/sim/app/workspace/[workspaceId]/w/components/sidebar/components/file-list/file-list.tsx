'use client'

import { memo, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileFolderApi } from '@/hooks/queries/workspace-file-folders'

interface FileFolderNode extends WorkspaceFileFolderApi {
  children: FileFolderNode[]
  files: WorkspaceFileRecord[]
}

function buildFileFolderTree(
  folders: WorkspaceFileFolderApi[],
  files: WorkspaceFileRecord[],
  parentId: string | null = null
): FileFolderNode[] {
  return folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((folder) => ({
      ...folder,
      children: buildFileFolderTree(folders, files, folder.id),
      files: files
        .filter((file) => (file.folderId ?? null) === folder.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
}

const INDENT_PER_LEVEL = 16

interface FileFolderNodeItemProps {
  node: FileFolderNode
  workspaceId: string
  currentFileId: string | undefined
  pathname: string | null
  level: number
}

const FileFolderNodeItem = memo(function FileFolderNodeItem({
  node,
  workspaceId,
  currentFileId,
  pathname,
  level,
}: FileFolderNodeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const hasChildren = node.children.length > 0 || node.files.length > 0

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
            'size-[14px] flex-shrink-0 text-[var(--text-icon)] transition-transform duration-150',
            isExpanded && hasChildren && 'rotate-90',
            !hasChildren && 'opacity-0'
          )}
        />
        <svg
          className='size-[16px] flex-shrink-0 text-[var(--text-icon)]'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'
        >
          {isExpanded && hasChildren ? (
            <>
              <path d='m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2' />
            </>
          ) : (
            <>
              <path d='M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' />
            </>
          )}
        </svg>
        <span className='min-w-0 flex-1 truncate text-left font-base text-[var(--text-body)]'>
          {node.name}
        </span>
      </button>

      {isExpanded && (
        <>
          {node.children.map((child) => (
            <FileFolderNodeItem
              key={child.id}
              node={child}
              workspaceId={workspaceId}
              currentFileId={currentFileId}
              pathname={pathname}
              level={level + 1}
            />
          ))}
          {node.files.map((file) => {
            const href = `/workspace/${workspaceId}/files/${file.id}`
            const isActive = currentFileId === file.id || pathname === href
            return (
              <Link
                key={file.id}
                href={href}
                className={cn(
                  'group mx-0.5 flex h-[30px] items-center gap-2 rounded-lg text-sm',
                  !isActive && 'hover-hover:bg-[var(--surface-hover)]',
                  isActive && 'bg-[var(--surface-active)]'
                )}
                style={{ paddingLeft: `${8 + (level + 1) * INDENT_PER_LEVEL + 14}px` }}
              >
                <svg
                  className='size-[14px] flex-shrink-0 text-[var(--text-icon)]'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  aria-hidden='true'
                >
                  <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
                  <path d='M14 2v4a2 2 0 0 0 2 2h4' />
                </svg>
                <span className='min-w-0 flex-1 truncate font-base text-[var(--text-body)]'>
                  {file.name}
                </span>
              </Link>
            )
          })}
        </>
      )}
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
  const rootFolderNodes = useMemo(() => buildFileFolderTree(folders, files, null), [folders, files])

  const rootFiles = useMemo(
    () =>
      files
        .filter((f) => (f.folderId ?? null) === null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [files]
  )

  return (
    <div className='flex flex-col'>
      {rootFolderNodes.map((node) => (
        <FileFolderNodeItem
          key={node.id}
          node={node}
          workspaceId={workspaceId}
          currentFileId={currentFileId}
          pathname={pathname}
          level={0}
        />
      ))}
      {rootFiles.map((file) => {
        const href = `/workspace/${workspaceId}/files/${file.id}`
        const isActive = currentFileId === file.id || pathname === href
        return (
          <Link
            key={file.id}
            href={href}
            className={cn(
              'group mx-0.5 flex h-[30px] items-center gap-2 rounded-lg px-2 text-sm',
              !isActive && 'hover-hover:bg-[var(--surface-hover)]',
              isActive && 'bg-[var(--surface-active)]'
            )}
          >
            <svg
              className='size-[14px] flex-shrink-0 text-[var(--text-icon)]'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden='true'
            >
              <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
              <path d='M14 2v4a2 2 0 0 0 2 2h4' />
            </svg>
            <span className='min-w-0 flex-1 truncate font-base text-[var(--text-body)]'>
              {file.name}
            </span>
          </Link>
        )
      })}
    </div>
  )
})
