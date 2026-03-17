'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { Database } from '@/components/emcn/icons'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import { ownerCell, Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import { BaseTagsModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import {
  CreateBaseModal,
  DeleteKnowledgeBaseModal,
  EditKnowledgeBaseModal,
  KnowledgeBaseContextMenu,
  KnowledgeListContextMenu,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import { filterKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/utils/sort'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
import { useDeleteKnowledgeBase, useUpdateKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'

const logger = createLogger('Knowledge')

interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'documents', header: 'Documents' },
  { id: 'tokens', header: 'Tokens' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

export function Knowledge() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { knowledgeBases, isLoading, error } = useKnowledgeBasesList(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)

  if (error) {
    logger.error('Failed to load knowledge bases:', error)
  }
  const userPermissions = useUserPermissionsContext()

  const { mutateAsync: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase(workspaceId)
  const { mutateAsync: deleteKnowledgeBaseMutation } = useDeleteKnowledgeBase(workspaceId)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const [activeKnowledgeBase, setActiveKnowledgeBase] = useState<KnowledgeBaseWithDocCount | null>(
    null
  )
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    menuRef: listMenuRef,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    menuRef: rowMenuRef,
    handleContextMenu: handleRowCtxMenu,
    closeMenu: closeRowContextMenu,
  } = useContextMenu()

  const handleContentContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('[data-resource-row]') ||
        target.closest('button, input, a, [role="button"]')
      ) {
        return
      }
      handleListContextMenu(e)
    },
    [handleListContextMenu]
  )

  const handleAddKnowledgeBase = useCallback(() => {
    setIsCreateModalOpen(true)
  }, [])

  const handleUpdateKnowledgeBase = useCallback(
    async (id: string, name: string, description: string) => {
      await updateKnowledgeBaseMutation({
        knowledgeBaseId: id,
        updates: { name, description },
      })
      logger.info(`Knowledge base updated: ${id}`)
    },
    [updateKnowledgeBaseMutation]
  )

  const handleDeleteKnowledgeBase = useCallback(
    async (id: string) => {
      await deleteKnowledgeBaseMutation({ knowledgeBaseId: id })
      logger.info(`Knowledge base deleted: ${id}`)
    },
    [deleteKnowledgeBaseMutation]
  )

  const filteredKnowledgeBases = useMemo(
    () => filterKnowledgeBases(knowledgeBases, debouncedSearchQuery),
    [knowledgeBases, debouncedSearchQuery]
  )

  const rows: ResourceRow[] = useMemo(
    () =>
      filteredKnowledgeBases.map((kb) => {
        const kbWithCount = kb as KnowledgeBaseWithDocCount
        return {
          id: kb.id,
          cells: {
            name: {
              icon: <Database className='h-[14px] w-[14px]' />,
              label: kb.name,
            },
            documents: {
              label: String(kbWithCount.docCount || 0),
            },
            tokens: {
              label: kb.tokenCount ? kb.tokenCount.toLocaleString() : '0',
            },
            created: timeCell(kb.createdAt),
            owner: ownerCell(kb.userId, members),
            updated: timeCell(kb.updatedAt),
          },
          sortValues: {
            documents: kbWithCount.docCount || 0,
            tokens: kb.tokenCount || 0,
            created: -new Date(kb.createdAt).getTime(),
            updated: -new Date(kb.updatedAt).getTime(),
          },
        }
      }),
    [filteredKnowledgeBases, members]
  )

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpen) return
      const kb = knowledgeBases.find((k) => k.id === rowId)
      if (!kb) return
      const urlParams = new URLSearchParams({ kbName: kb.name })
      router.push(`/workspace/${workspaceId}/knowledge/${rowId}?${urlParams.toString()}`)
    },
    [isRowContextMenuOpen, knowledgeBases, router, workspaceId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const kb = knowledgeBases.find((k) => k.id === rowId) as KnowledgeBaseWithDocCount | undefined
      setActiveKnowledgeBase(kb ?? null)
      handleRowCtxMenu(e)
    },
    [knowledgeBases, handleRowCtxMenu]
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!activeKnowledgeBase) return
    setIsDeleting(true)
    try {
      await handleDeleteKnowledgeBase(activeKnowledgeBase.id)
      setIsDeleteModalOpen(false)
      setActiveKnowledgeBase(null)
    } finally {
      setIsDeleting(false)
    }
  }, [activeKnowledgeBase, handleDeleteKnowledgeBase])

  return (
    <>
      <Resource
        icon={Database}
        title='Knowledge Base'
        create={{
          label: 'New base',
          onClick: () => setIsCreateModalOpen(true),
          disabled: userPermissions.canEdit !== true,
        }}
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search knowledge bases...',
        }}
        defaultSort='created'
        columns={COLUMNS}
        rows={rows}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
        onContextMenu={handleContentContextMenu}
      />

      <KnowledgeListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onAddKnowledgeBase={handleAddKnowledgeBase}
        disableAdd={userPermissions.canEdit !== true}
      />

      {activeKnowledgeBase && (
        <KnowledgeBaseContextMenu
          isOpen={isRowContextMenuOpen}
          position={rowContextMenuPosition}
          onClose={closeRowContextMenu}
          onOpenInNewTab={() => {
            const urlParams = new URLSearchParams({ kbName: activeKnowledgeBase.name })
            window.open(
              `/workspace/${workspaceId}/knowledge/${activeKnowledgeBase.id}?${urlParams.toString()}`,
              '_blank'
            )
          }}
          onViewTags={() => setIsTagsModalOpen(true)}
          onCopyId={() => navigator.clipboard.writeText(activeKnowledgeBase.id)}
          onEdit={() => setIsEditModalOpen(true)}
          onDelete={() => setIsDeleteModalOpen(true)}
          showOpenInNewTab
          showViewTags
          showEdit
          showDelete
          disableEdit={!userPermissions.canEdit}
          disableDelete={!userPermissions.canEdit}
        />
      )}

      {activeKnowledgeBase && (
        <EditKnowledgeBaseModal
          open={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
          knowledgeBaseId={activeKnowledgeBase.id}
          initialName={activeKnowledgeBase.name}
          initialDescription={activeKnowledgeBase.description || ''}
          onSave={handleUpdateKnowledgeBase}
        />
      )}

      {activeKnowledgeBase && (
        <DeleteKnowledgeBaseModal
          isOpen={isDeleteModalOpen}
          onClose={() => {
            setIsDeleteModalOpen(false)
            setActiveKnowledgeBase(null)
          }}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
          knowledgeBaseName={activeKnowledgeBase.name}
        />
      )}

      {activeKnowledgeBase && (
        <BaseTagsModal
          open={isTagsModalOpen}
          onOpenChange={setIsTagsModalOpen}
          knowledgeBaseId={activeKnowledgeBase.id}
        />
      )}

      <CreateBaseModal open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen} />
    </>
  )
}
