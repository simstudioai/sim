'use client'

import { useCallback, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Badge, DocumentAttachment, Tooltip } from '@/components/emcn'
import { formatAbsoluteDate, formatRelativeTime } from '@/lib/core/utils/formatting'
import { BaseTagsModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { DeleteKnowledgeBaseModal } from '../delete-knowledge-base-modal/delete-knowledge-base-modal'
import { EditKnowledgeBaseModal } from '../edit-knowledge-base-modal/edit-knowledge-base-modal'
import { KnowledgeBaseContextMenu } from '../knowledge-base-context-menu/knowledge-base-context-menu'

interface BaseCardProps {
  id?: string
  title: string
  docCount: number
  description: string
  createdAt?: string
  updatedAt?: string
  onUpdate?: (id: string, name: string, description: string) => Promise<void>
  onDelete?: (id: string) => Promise<void>
}

/**
 * Skeleton placeholder for a knowledge base card
 */
export function BaseCardSkeleton() {
  return (
    <div className='group flex h-full cursor-pointer flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] transition-colors hover:bg-[var(--surface-4)] dark:bg-[var(--surface-4)] dark:hover:bg-[var(--surface-5)]'>
      <div className='flex items-center justify-between gap-[8px]'>
        <div className='h-[17px] w-[120px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
        <div className='h-[22px] w-[90px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
      </div>

      <div className='flex flex-1 flex-col gap-[8px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[6px]'>
            <div className='h-[12px] w-[12px] animate-pulse rounded-[2px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            <div className='h-[15px] w-[45px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
          </div>
          <div className='h-[15px] w-[120px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
        </div>

        <div className='h-0 w-full border-[var(--divider)] border-t' />

        <div className='flex h-[36px] flex-col gap-[6px]'>
          <div className='h-[15px] w-full animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
          <div className='h-[15px] w-[75%] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
        </div>
      </div>
    </div>
  )
}

/**
 * Renders multiple knowledge base card skeletons as a fragment
 */
export function BaseCardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <BaseCardSkeleton key={i} />
      ))}
    </>
  )
}

/**
 * Knowledge base card component displaying overview information
 */
export function BaseCard({
  id,
  title,
  docCount,
  description,
  updatedAt,
  onUpdate,
  onDelete,
}: BaseCardProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string
  const userPermissions = useUserPermissionsContext()

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const searchParams = new URLSearchParams({
    kbName: title,
  })
  const href = `/workspace/${workspaceId}/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}?${searchParams.toString()}`

  const shortId = id ? `kb-${id.slice(0, 8)}` : ''

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isContextMenuOpen) {
        e.preventDefault()
        return
      }
      router.push(href)
    },
    [isContextMenuOpen, router, href]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        router.push(href)
      }
    },
    [router, href]
  )

  const handleOpenInNewTab = useCallback(() => {
    window.open(href, '_blank')
  }, [href])

  const handleViewTags = useCallback(() => {
    setIsTagsModalOpen(true)
  }, [])

  const handleEdit = useCallback(() => {
    setIsEditModalOpen(true)
  }, [])

  const handleDelete = useCallback(() => {
    setIsDeleteModalOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!id || !onDelete) return
    setIsDeleting(true)
    try {
      await onDelete(id)
      setIsDeleteModalOpen(false)
    } finally {
      setIsDeleting(false)
    }
  }, [id, onDelete])

  const handleSave = useCallback(
    async (knowledgeBaseId: string, name: string, newDescription: string) => {
      if (!onUpdate) return
      await onUpdate(knowledgeBaseId, name, newDescription)
    },
    [onUpdate]
  )

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        className='h-full cursor-pointer'
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        data-kb-card
      >
        <div className='group flex h-full flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] transition-colors hover:bg-[var(--surface-4)] dark:bg-[var(--surface-4)] dark:hover:bg-[var(--surface-5)]'>
          <div className='flex items-center justify-between gap-[8px]'>
            <h3 className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
              {title}
            </h3>
            {shortId && (
              <Badge className='flex-shrink-0 rounded-[4px] text-[12px]'>{shortId}</Badge>
            )}
          </div>

          <div className='flex flex-1 flex-col gap-[8px]'>
            <div className='flex items-center justify-between'>
              <span className='flex items-center gap-[6px] text-[12px] text-[var(--text-tertiary)]'>
                <DocumentAttachment className='h-[12px] w-[12px]' />
                {docCount} {docCount === 1 ? 'doc' : 'docs'}
              </span>
              {updatedAt && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='text-[12px] text-[var(--text-tertiary)]'>
                      last updated: {formatRelativeTime(updatedAt)}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content>{formatAbsoluteDate(updatedAt)}</Tooltip.Content>
                </Tooltip.Root>
              )}
            </div>

            <div className='h-0 w-full border-[var(--divider)] border-t' />

            <p className='line-clamp-2 h-[36px] text-[12px] text-[var(--text-tertiary)] leading-[18px]'>
              {description}
            </p>
          </div>
        </div>
      </div>

      <KnowledgeBaseContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={menuRef}
        onClose={closeContextMenu}
        onOpenInNewTab={handleOpenInNewTab}
        onViewTags={handleViewTags}
        onCopyId={id ? () => navigator.clipboard.writeText(id) : undefined}
        onEdit={handleEdit}
        onDelete={handleDelete}
        showOpenInNewTab={true}
        showViewTags={!!id}
        showEdit={!!onUpdate}
        showDelete={!!onDelete}
        disableEdit={!userPermissions.canEdit}
        disableDelete={!userPermissions.canEdit}
      />

      {id && onUpdate && (
        <EditKnowledgeBaseModal
          open={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
          knowledgeBaseId={id}
          initialName={title}
          initialDescription={description === 'No description provided' ? '' : description}
          onSave={handleSave}
        />
      )}

      {id && onDelete && (
        <DeleteKnowledgeBaseModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
          knowledgeBaseName={title}
        />
      )}

      {id && (
        <BaseTagsModal
          open={isTagsModalOpen}
          onOpenChange={setIsTagsModalOpen}
          knowledgeBaseId={id}
        />
      )}
    </>
  )
}
