'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Database } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { formatRelativeTime } from '@/lib/core/utils/formatting'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import { Resource } from '@/app/workspace/[workspaceId]/components'
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
import { useDebounce } from '@/hooks/use-debounce'

const logger = createLogger('Knowledge')

interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', width: 'w-[35%]' },
  { id: 'documents', header: 'Documents', width: 'w-[12%]' },
  { id: 'description', header: 'Description', width: 'w-[28%]' },
  { id: 'updated', header: 'Updated', width: 'w-[13%]' },
  { id: 'id', header: 'ID', width: 'w-[12%]' },
]

export function Knowledge() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { knowledgeBases, isLoading, error } = useKnowledgeBasesList(workspaceId)
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

  const handleSort = useCallback(() => {}, [])

  const handleFilter = useCallback(() => {}, [])

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
            description: {
              label: kb.description || 'No description',
            },
            updated: {
              label: kb.updatedAt ? formatRelativeTime(kb.updatedAt) : '',
            },
            id: {
              label: `kb-${kb.id.slice(0, 8)}`,
            },
          },
        }
      }),
    [filteredKnowledgeBases]
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

  const emptyState = useMemo(() => {
    if (debouncedSearchQuery) {
      return {
        title: 'No knowledge bases found',
        description: 'Try a different search term',
      }
    }
    return {
      title: 'No knowledge bases yet',
      description:
        userPermissions.canEdit === true
          ? 'Create a knowledge base to get started'
          : 'Knowledge bases will appear here once created',
    }
  }, [debouncedSearchQuery, userPermissions.canEdit])

  return (
    <>
      <Resource
        icon={Database}
        title='Knowledge Base'
        create={{
          label: 'Create',
          onClick: () => setIsCreateModalOpen(true),
          disabled: userPermissions.canEdit !== true,
        }}
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search knowledge bases...',
        }}
        onSort={handleSort}
        onFilter={handleFilter}
        columns={COLUMNS}
        rows={rows}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
        error={
          error
            ? {
                title: 'Error loading knowledge bases',
                description: error,
              }
            : undefined
        }
        emptyState={emptyState}
        onContextMenu={handleContentContextMenu}
      />

      <KnowledgeListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        menuRef={listMenuRef}
        onClose={closeListContextMenu}
        onAddKnowledgeBase={handleAddKnowledgeBase}
        disableAdd={userPermissions.canEdit !== true}
      />

      {activeKnowledgeBase && (
        <KnowledgeBaseContextMenu
          isOpen={isRowContextMenuOpen}
          position={rowContextMenuPosition}
          menuRef={rowMenuRef}
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
