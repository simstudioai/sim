'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ChevronDown, Database, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { Input } from '@/components/ui/input'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import {
  BaseCard,
  BaseCardSkeletonGrid,
  CreateBaseModal,
  KnowledgeListContextMenu,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  SORT_OPTIONS,
  type SortOption,
  type SortOrder,
} from '@/app/workspace/[workspaceId]/knowledge/components/constants'
import {
  filterKnowledgeBases,
  sortKnowledgeBases,
} from '@/app/workspace/[workspaceId]/knowledge/utils/sort'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
import { useDeleteKnowledgeBase, useUpdateKnowledgeBase } from '@/hooks/queries/knowledge'
import { useDebounce } from '@/hooks/use-debounce'

const logger = createLogger('Knowledge')

/**
 * Extended knowledge base data with document count
 */
interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

/**
 * Knowledge base list component displaying all knowledge bases in a workspace
 * Supports filtering by search query and sorting options
 */
export function Knowledge() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { knowledgeBases, isLoading, error } = useKnowledgeBasesList(workspaceId)
  const userPermissions = useUserPermissionsContext()

  const { mutateAsync: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase(workspaceId)
  const { mutateAsync: deleteKnowledgeBaseMutation } = useDeleteKnowledgeBase(workspaceId)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isSortPopoverOpen, setIsSortPopoverOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>('updatedAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    menuRef: listMenuRef,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  /**
   * Handle context menu on the content area - only show menu when clicking on empty space
   */
  const handleContentContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      const isOnCard = target.closest('[data-kb-card]')
      const isOnInteractive = target.closest('button, input, a, [role="button"]')

      if (!isOnCard && !isOnInteractive) {
        handleListContextMenu(e)
      }
    },
    [handleListContextMenu]
  )

  /**
   * Handle add knowledge base from context menu
   */
  const handleAddKnowledgeBase = useCallback(() => {
    setIsCreateModalOpen(true)
  }, [])

  const currentSortValue = `${sortBy}-${sortOrder}`
  const currentSortLabel =
    SORT_OPTIONS.find((opt) => opt.value === currentSortValue)?.label || 'Last Updated'

  /**
   * Handles sort option change from dropdown
   */
  const handleSortChange = (value: string) => {
    const [field, order] = value.split('-') as [SortOption, SortOrder]
    setSortBy(field)
    setSortOrder(order)
    setIsSortPopoverOpen(false)
  }

  /**
   * Updates a knowledge base name and description
   */
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

  /**
   * Deletes a knowledge base
   */
  const handleDeleteKnowledgeBase = useCallback(
    async (id: string) => {
      await deleteKnowledgeBaseMutation({ knowledgeBaseId: id })
      logger.info(`Knowledge base deleted: ${id}`)
    },
    [deleteKnowledgeBaseMutation]
  )

  /**
   * Filter and sort knowledge bases based on search query and sort options
   */
  const filteredAndSortedKnowledgeBases = useMemo(() => {
    const filtered = filterKnowledgeBases(knowledgeBases, debouncedSearchQuery)
    return sortKnowledgeBases(filtered, sortBy, sortOrder)
  }, [knowledgeBases, debouncedSearchQuery, sortBy, sortOrder])

  /**
   * Format knowledge base data for display in the card
   */
  const formatKnowledgeBaseForDisplay = (kb: KnowledgeBaseWithDocCount) => ({
    id: kb.id,
    title: kb.name,
    docCount: kb.docCount || 0,
    description: kb.description || 'No description provided',
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
  })

  /**
   * Get empty state content based on current filters
   */
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
      <div className='flex h-full flex-1 flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          <div
            className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[28px] pb-[24px] dark:bg-[var(--bg)]'
            onContextMenu={handleContentContextMenu}
          >
            <div>
              <div className='flex items-start gap-[12px]'>
                <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#5BB377] bg-[#E8F7EE] dark:border-[#1E5A3E] dark:bg-[#0F3D2C]'>
                  <Database className='h-[14px] w-[14px] text-[#5BB377] dark:text-[#34D399]' />
                </div>
                <h1 className='font-medium text-[18px]'>Knowledge Base</h1>
              </div>
              <p className='mt-[10px] text-[14px] text-[var(--text-tertiary)]'>
                Create and manage knowledge bases with custom files.
              </p>
            </div>

            <div className='mt-[14px] flex items-center justify-between'>
              <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-4)] px-[8px]'>
                <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
                <Input
                  placeholder='Search'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
                />
              </div>
              <div className='flex items-center gap-[8px]'>
                {knowledgeBases.length > 0 && (
                  <Popover open={isSortPopoverOpen} onOpenChange={setIsSortPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant='default' className='h-[32px] rounded-[6px]'>
                        {currentSortLabel}
                        <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align='end' side='bottom' sideOffset={4}>
                      <div className='flex flex-col gap-[2px]'>
                        {SORT_OPTIONS.map((option) => (
                          <PopoverItem
                            key={option.value}
                            active={currentSortValue === option.value}
                            onClick={() => handleSortChange(option.value)}
                          >
                            {option.label}
                          </PopoverItem>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <Button
                      onClick={() => setIsCreateModalOpen(true)}
                      disabled={userPermissions.canEdit !== true}
                      variant='tertiary'
                      className='h-[32px] rounded-[6px]'
                    >
                      Create
                    </Button>
                  </Tooltip.Trigger>
                  {userPermissions.canEdit !== true && (
                    <Tooltip.Content>
                      Write permission required to create knowledge bases
                    </Tooltip.Content>
                  )}
                </Tooltip.Root>
              </div>
            </div>

            <div className='mt-[24px] grid grid-cols-1 gap-[20px] md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {isLoading ? (
                <BaseCardSkeletonGrid count={8} />
              ) : filteredAndSortedKnowledgeBases.length === 0 ? (
                <div className='col-span-full flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                  <div className='text-center'>
                    <p className='font-medium text-[var(--text-secondary)] text-sm'>
                      {emptyState.title}
                    </p>
                    <p className='mt-1 text-[var(--text-muted)] text-xs'>
                      {emptyState.description}
                    </p>
                  </div>
                </div>
              ) : error ? (
                <div className='col-span-full flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                  <div className='text-center'>
                    <p className='font-medium text-[var(--text-secondary)] text-sm'>
                      Error loading knowledge bases
                    </p>
                    <p className='mt-1 text-[var(--text-muted)] text-xs'>{error}</p>
                  </div>
                </div>
              ) : (
                filteredAndSortedKnowledgeBases.map((kb) => {
                  const displayData = formatKnowledgeBaseForDisplay(kb as KnowledgeBaseWithDocCount)
                  return (
                    <BaseCard
                      key={kb.id}
                      id={displayData.id}
                      title={displayData.title}
                      docCount={displayData.docCount}
                      description={displayData.description}
                      createdAt={displayData.createdAt}
                      updatedAt={displayData.updatedAt}
                      onUpdate={handleUpdateKnowledgeBase}
                      onDelete={handleDeleteKnowledgeBase}
                    />
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <KnowledgeListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        menuRef={listMenuRef}
        onClose={closeListContextMenu}
        onAddKnowledgeBase={handleAddKnowledgeBase}
        disableAdd={userPermissions.canEdit !== true}
      />

      <CreateBaseModal open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen} />
    </>
  )
}
