'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ChipDropdownOption } from '@/components/emcn'
import { Button, ChipDropdown, Plus, Tooltip } from '@/components/emcn'
import { Database } from '@/components/emcn/icons'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import type {
  FilterTag,
  ResourceAction,
  ResourceCell,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import {
  EMPTY_CELL_PLACEHOLDER,
  ownerCell,
  Resource,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
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
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
import { useDeleteKnowledgeBase, useUpdateKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('Knowledge')

interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'documents', header: 'Documents', widthMultiplier: 0.6 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
  { id: 'connectors', header: 'Connectors', widthMultiplier: 0.7 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const KNOWLEDGE_BASE_ICON = <Database className='size-[14px]' />

const CONNECTOR_FILTER_OPTIONS: ChipDropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'connected', label: 'With connectors' },
  { value: 'unconnected', label: 'Without connectors' },
]

const CONTENT_FILTER_OPTIONS: ChipDropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'has-docs', label: 'Has documents' },
  { value: 'empty', label: 'Empty' },
]

const FILTER_SECTION_LABEL_CLASS = 'text-[var(--text-muted)] text-small'

function connectorCell(connectorTypes?: string[]): ResourceCell {
  if (!connectorTypes || connectorTypes.length === 0) {
    return { label: EMPTY_CELL_PLACEHOLDER }
  }

  const entries = connectorTypes
    .map((type) => ({ type, def: CONNECTOR_META_REGISTRY[type] }))
    .filter(
      (e): e is { type: string; def: NonNullable<(typeof CONNECTOR_META_REGISTRY)[string]> } =>
        Boolean(e.def?.icon)
    )

  if (entries.length === 0) return { label: EMPTY_CELL_PLACEHOLDER }

  const visibleEntries = entries.slice(0, 3)
  const hiddenEntries = entries.slice(3)

  return {
    content: (
      <div className='flex items-center gap-1'>
        {visibleEntries.map(({ type, def }) => {
          const Icon = def.icon
          return (
            <Tooltip.Root key={type}>
              <Tooltip.Trigger asChild>
                <span className='flex size-5 flex-shrink-0 items-center justify-center rounded-md bg-[var(--surface-4)] text-[var(--text-secondary)]'>
                  <Icon className='size-[13px]' />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content>{def.name}</Tooltip.Content>
            </Tooltip.Root>
          )
        })}
        {hiddenEntries.length > 0 && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='flex size-5 flex-shrink-0 items-center justify-center rounded-md bg-[var(--surface-4)] font-medium text-[var(--text-muted)] text-micro'>
                +{hiddenEntries.length}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content>{hiddenEntries.map(({ def }) => def.name).join(', ')}</Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
    ),
  }
}

export function Knowledge() {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { config: permissionConfig } = usePermissionConfig()
  useEffect(() => {
    if (permissionConfig.hideKnowledgeBaseTab) {
      router.replace(`/workspace/${workspaceId}`)
    }
  }, [permissionConfig.hideKnowledgeBaseTab, router, workspaceId])

  const { knowledgeBases, error } = useKnowledgeBasesList(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)

  if (error) {
    logger.error('Failed to load knowledge bases:', error)
  }
  const userPermissions = useUserPermissionsContext()

  const { mutateAsync: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase(workspaceId)
  const { mutateAsync: deleteKnowledgeBaseMutation } = useDeleteKnowledgeBase(workspaceId)

  const [activeSort, setActiveSort] = useState<{
    column: string
    direction: 'asc' | 'desc'
  } | null>(null)
  const [connectorFilter, setConnectorFilter] = useState<string[]>([])
  const [contentFilter, setContentFilter] = useState<string[]>([])
  const [ownerFilter, setOwnerFilter] = useState<string[]>([])

  const [searchInputValue, setSearchInputValue] = useState('')
  const debouncedSearchQuery = useDebounce(searchInputValue, 300)

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
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    handleContextMenu: handleRowCtxMenu,
    closeMenu: closeRowContextMenu,
  } = useContextMenu()

  const isRowContextMenuOpenRef = useRef(isRowContextMenuOpen)
  isRowContextMenuOpenRef.current = isRowContextMenuOpen

  const knowledgeBasesRef = useRef(knowledgeBases)
  knowledgeBasesRef.current = knowledgeBases

  const activeKnowledgeBaseRef = useRef(activeKnowledgeBase)
  activeKnowledgeBaseRef.current = activeKnowledgeBase

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

  const handleOpenCreateModal = useCallback(() => {
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

  const processedKBs = useMemo(() => {
    let result = filterKnowledgeBases(knowledgeBases, debouncedSearchQuery)

    if (connectorFilter.length > 0) {
      result = result.filter((kb) => {
        const hasConnectors = (kb.connectorTypes?.length ?? 0) > 0
        if (connectorFilter.includes('connected') && hasConnectors) return true
        if (connectorFilter.includes('unconnected') && !hasConnectors) return true
        return false
      })
    }

    if (contentFilter.length > 0) {
      const docCount = (kb: KnowledgeBaseData) => (kb as KnowledgeBaseWithDocCount).docCount ?? 0
      result = result.filter((kb) => {
        if (contentFilter.includes('has-docs') && docCount(kb) > 0) return true
        if (contentFilter.includes('empty') && docCount(kb) === 0) return true
        return false
      })
    }

    if (ownerFilter.length > 0) {
      result = result.filter((kb) => ownerFilter.includes(kb.userId))
    }

    const col = activeSort?.column ?? 'updated'
    const dir = activeSort?.direction ?? 'desc'
    return [...result].sort((a, b) => {
      let cmp = 0
      switch (col) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'documents':
          cmp =
            ((a as KnowledgeBaseWithDocCount).docCount || 0) -
            ((b as KnowledgeBaseWithDocCount).docCount || 0)
          break
        case 'tokens':
          cmp = (a.tokenCount || 0) - (b.tokenCount || 0)
          break
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'updated':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'connectors':
          cmp = (a.connectorTypes?.length ?? 0) - (b.connectorTypes?.length ?? 0)
          break
        case 'owner':
          cmp = (members?.find((m) => m.userId === a.userId)?.name ?? '').localeCompare(
            members?.find((m) => m.userId === b.userId)?.name ?? ''
          )
          break
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [
    knowledgeBases,
    debouncedSearchQuery,
    connectorFilter,
    contentFilter,
    ownerFilter,
    activeSort,
    members,
  ])

  const rows: ResourceRow[] = useMemo(
    () =>
      processedKBs.map((kb) => {
        const kbWithCount = kb as KnowledgeBaseWithDocCount
        return {
          id: kb.id,
          cells: {
            name: {
              icon: KNOWLEDGE_BASE_ICON,
              label: kb.name,
            },
            documents: {
              label: String(kbWithCount.docCount || 0),
            },
            tokens: {
              label: kb.tokenCount ? kb.tokenCount.toLocaleString() : '0',
            },
            connectors: connectorCell(kb.connectorTypes),
            created: timeCell(kb.createdAt),
            owner: ownerCell(kb.userId, members),
            updated: timeCell(kb.updatedAt),
          },
        }
      }),
    [processedKBs, members]
  )

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpenRef.current) return
      const kb = knowledgeBasesRef.current.find((k) => k.id === rowId)
      if (!kb) return
      const urlParams = new URLSearchParams({ kbName: kb.name })
      router.push(`/workspace/${workspaceId}/knowledge/${rowId}?${urlParams.toString()}`)
    },
    [router, workspaceId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const kb = knowledgeBasesRef.current.find((k) => k.id === rowId) as
        | KnowledgeBaseWithDocCount
        | undefined
      setActiveKnowledgeBase(kb ?? null)
      handleRowCtxMenu(e)
    },
    [handleRowCtxMenu]
  )

  const handleConfirmDelete = useCallback(async () => {
    const kb = activeKnowledgeBaseRef.current
    if (!kb) return
    setIsDeleting(true)
    try {
      await handleDeleteKnowledgeBase(kb.id)
      setIsDeleteModalOpen(false)
      setActiveKnowledgeBase(null)
    } finally {
      setIsDeleting(false)
    }
  }, [handleDeleteKnowledgeBase])

  const handleCloseDeleteModal = useCallback(() => {
    setIsDeleteModalOpen(false)
    setActiveKnowledgeBase(null)
  }, [])

  const handleOpenInNewTab = useCallback(() => {
    const kb = activeKnowledgeBaseRef.current
    if (!kb) return
    const urlParams = new URLSearchParams({ kbName: kb.name })
    window.open(`/workspace/${workspaceId}/knowledge/${kb.id}?${urlParams.toString()}`, '_blank')
  }, [workspaceId])

  const handleViewTags = useCallback(() => {
    setIsTagsModalOpen(true)
  }, [])

  const handleCopyId = useCallback(() => {
    const kb = activeKnowledgeBaseRef.current
    if (kb) {
      navigator.clipboard.writeText(kb.id)
    }
  }, [])

  const handleEdit = useCallback(() => {
    setIsEditModalOpen(true)
  }, [])

  const handleDelete = useCallback(() => {
    setIsDeleteModalOpen(true)
  }, [])

  const canEdit = userPermissions.canEdit === true

  const headerActions: ResourceAction[] = useMemo(
    () => [
      {
        text: 'New base',
        icon: Plus,
        onSelect: handleOpenCreateModal,
        disabled: !canEdit,
        variant: 'primary',
      },
    ],
    [handleOpenCreateModal, canEdit]
  )

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: searchInputValue,
      onChange: setSearchInputValue,
      onClearAll: () => setSearchInputValue(''),
      placeholder: 'Search knowledge bases...',
    }),
    [searchInputValue]
  )

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [
        { id: 'name', label: 'Name' },
        { id: 'documents', label: 'Documents' },
        { id: 'tokens', label: 'Tokens' },
        { id: 'connectors', label: 'Connectors' },
        { id: 'created', label: 'Created' },
        { id: 'updated', label: 'Last Updated' },
        { id: 'owner', label: 'Owner' },
      ],
      active: activeSort,
      onSort: (column, direction) => setActiveSort({ column, direction }),
      onClear: () => setActiveSort(null),
    }),
    [activeSort]
  )

  const memberOptions: ChipDropdownOption[] = useMemo(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.name,
        iconElement: m.image ? (
          <img
            src={m.image}
            alt={m.name}
            referrerPolicy='no-referrer'
            className='size-[14px] rounded-full border border-[var(--border)] object-cover'
          />
        ) : (
          <span className='flex size-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
            {m.name.charAt(0).toUpperCase()}
          </span>
        ),
      })),
    [members]
  )

  const filterContent = useMemo(
    () => (
      <div className='flex w-[260px] flex-col gap-3 p-3'>
        <div className='flex flex-col gap-2'>
          <div className='flex h-5 items-center justify-between'>
            <span className={FILTER_SECTION_LABEL_CLASS}>{t('connectors')}</span>
            {connectorFilter.length > 0 && (
              <Button
                variant='ghost'
                onClick={() => setConnectorFilter([])}
                className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-xs hover-hover:text-[var(--text-secondary)]'
              >
                {t('clear')}
              </Button>
            )}
          </div>
          <ChipDropdown
            options={CONNECTOR_FILTER_OPTIONS}
            value={connectorFilter[0] ?? 'all'}
            onChange={(value) => setConnectorFilter(value === 'all' ? [] : [value])}
            align='start'
            fullWidth
            flush
          />
        </div>
        <div className='flex flex-col gap-2'>
          <div className='flex h-5 items-center justify-between'>
            <span className={FILTER_SECTION_LABEL_CLASS}>{t('content')}</span>
            {contentFilter.length > 0 && (
              <Button
                variant='ghost'
                onClick={() => setContentFilter([])}
                className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-xs hover-hover:text-[var(--text-secondary)]'
              >
                {t('clear')}
              </Button>
            )}
          </div>
          <ChipDropdown
            options={CONTENT_FILTER_OPTIONS}
            value={contentFilter[0] ?? 'all'}
            onChange={(value) => setContentFilter(value === 'all' ? [] : [value])}
            align='start'
            fullWidth
            flush
          />
        </div>
        {memberOptions.length > 0 && (
          <div className='flex flex-col gap-2'>
            <div className='flex h-5 items-center justify-between'>
              <span className={FILTER_SECTION_LABEL_CLASS}>{t('owner')}</span>
              {ownerFilter.length > 0 && (
                <Button
                  variant='ghost'
                  onClick={() => setOwnerFilter([])}
                  className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-xs hover-hover:text-[var(--text-secondary)]'
                >
                  {t('clear')}
                </Button>
              )}
            </div>
            <ChipDropdown
              multiple
              options={memberOptions}
              value={ownerFilter}
              onChange={setOwnerFilter}
              allLabel='All'
              searchable
              searchPlaceholder={tI18n('search_members')}
              align='start'
              fullWidth
              flush
            />
          </div>
        )}
      </div>
    ),
    [connectorFilter, contentFilter, ownerFilter, memberOptions]
  )

  const filterTags: FilterTag[] = useMemo(() => {
    const tags: FilterTag[] = []
    if (connectorFilter.length > 0) {
      const label =
        connectorFilter.length === 1
          ? `Connectors: ${connectorFilter[0] === 'connected' ? 'With connectors' : 'Without connectors'}`
          : `Connectors: ${connectorFilter.length} types`
      tags.push({ label, onRemove: () => setConnectorFilter([]) })
    }
    if (contentFilter.length > 0) {
      const label =
        contentFilter.length === 1
          ? `Content: ${contentFilter[0] === 'has-docs' ? 'Has documents' : 'Empty'}`
          : `Content: ${contentFilter.length} types`
      tags.push({ label, onRemove: () => setContentFilter([]) })
    }
    if (ownerFilter.length > 0) {
      const label =
        ownerFilter.length === 1
          ? `Owner: ${members?.find((m) => m.userId === ownerFilter[0])?.name ?? '1 member'}`
          : `Owner: ${ownerFilter.length} members`
      tags.push({ label, onRemove: () => setOwnerFilter([]) })
    }
    return tags
  }, [connectorFilter, contentFilter, ownerFilter, members])

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header icon={Database} title={t('knowledge_base')} actions={headerActions} />
        <Resource.Options
          search={searchConfig}
          sort={sortConfig}
          filterTags={filterTags}
          filter={{ content: filterContent }}
        />
        <Resource.Table
          columns={COLUMNS}
          rows={rows}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
        />
      </Resource>

      <KnowledgeListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onAddKnowledgeBase={handleOpenCreateModal}
        disableAdd={!canEdit}
      />

      {activeKnowledgeBase && (
        <KnowledgeBaseContextMenu
          isOpen={isRowContextMenuOpen}
          position={rowContextMenuPosition}
          onClose={closeRowContextMenu}
          onOpenInNewTab={handleOpenInNewTab}
          onViewTags={handleViewTags}
          onCopyId={handleCopyId}
          onEdit={handleEdit}
          onDelete={handleDelete}
          showOpenInNewTab
          showViewTags
          showEdit
          showDelete
          disableEdit={!canEdit}
          disableDelete={!canEdit}
        />
      )}

      {activeKnowledgeBase && (
        <EditKnowledgeBaseModal
          open={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
          knowledgeBaseId={activeKnowledgeBase.id}
          initialName={activeKnowledgeBase.name}
          initialDescription={activeKnowledgeBase.description || ''}
          chunkingConfig={activeKnowledgeBase.chunkingConfig}
          onSave={handleUpdateKnowledgeBase}
        />
      )}

      {activeKnowledgeBase && (
        <DeleteKnowledgeBaseModal
          isOpen={isDeleteModalOpen}
          onClose={handleCloseDeleteModal}
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
