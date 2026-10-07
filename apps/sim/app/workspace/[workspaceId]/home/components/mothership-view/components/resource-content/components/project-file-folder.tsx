'use client'

import { useRef } from 'react'
import {
  Chip,
  cn,
  Skeleton,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { Folder } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { FileOwner } from '@/lib/workspace-files/ownership'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { useProjectFileFolders, useProjectFiles } from '@/hooks/queries/project-files'
import { useFileListRoom } from '@/hooks/use-file-list-room'

interface EmbeddedProjectFileFolderProps {
  owner: FileOwner & { entityType: 'project' }
  folderId: string
}

export function EmbeddedProjectFileFolder({ owner, folderId }: EmbeddedProjectFileFolderProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { addResource } = useMothershipResources()
  useFileListRoom(owner)
  const folders = useProjectFileFolders(owner.entityId)
  const folder = folders.data?.folders.find((item) => item.id === folderId)
  const list = useProjectFiles(
    owner.entityId,
    {
      scope: 'active',
      folderId,
      types: [],
      sizes: [],
      creatorIds: [],
      sortBy: 'name',
      sortOrder: 'asc',
      limit: 100,
    },
    Boolean(folder)
  )
  const edges = useScrollEdges(scrollRef, { enabled: Boolean(folder) && list.isSuccess })

  if (folders.isPending || (folder && list.isPending)) {
    return (
      <div className='flex h-full flex-col gap-2 p-6'>
        <Skeleton className='h-4 w-3/5' />
        <Skeleton className='h-4 w-4/5' />
      </div>
    )
  }
  if (folders.isError || list.isError || !folder) {
    return (
      <p role='status' className='p-6 text-[var(--text-muted)] text-small'>
        {getErrorMessage(folders.error ?? list.error, 'This Project folder is unavailable')}
      </p>
    )
  }

  const items = list.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div
      ref={scrollRef}
      className={cn('h-full overflow-y-auto p-6', scrollFadeClass)}
      {...scrollFadeAttributes(edges)}
    >
      <div>
        <h2 className='mb-4 text-[var(--text-body)] text-md'>{folder.name}</h2>
        {items.length === 0 ? (
          <p className='text-[var(--text-muted)] text-small'>This folder is empty</p>
        ) : (
          <div className='flex flex-col gap-1'>
            {items.map((item) => {
              const Icon = item.kind === 'folder' ? Folder : getDocumentIcon(item.type, item.name)
              return (
                <Chip
                  key={`${item.kind}:${item.id}`}
                  fullWidth
                  leftIcon={Icon}
                  onClick={() =>
                    addResource({
                      type: item.kind === 'folder' ? 'filefolder' : 'file',
                      id: item.id,
                      title: item.name,
                      owner,
                    })
                  }
                >
                  {item.name}
                </Chip>
              )
            })}
          </div>
        )}
        {list.hasNextPage && (
          <Chip
            className='mt-3'
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Loading' : 'Load more'}
          </Chip>
        )}
      </div>
    </div>
  )
}
