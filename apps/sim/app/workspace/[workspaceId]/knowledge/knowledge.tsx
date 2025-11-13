'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, LibraryBig, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Tooltip } from '@/components/emcn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  BaseOverview,
  CreateModal,
  EmptyStateCard,
  KnowledgeBaseCardSkeletonGrid,
  KnowledgeHeader,
  PrimaryButton,
  SearchInput,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  SORT_OPTIONS,
  type SortOption,
  type SortOrder,
} from '@/app/workspace/[workspaceId]/knowledge/components/shared'
import {
  filterKnowledgeBases,
  sortKnowledgeBases,
} from '@/app/workspace/[workspaceId]/knowledge/utils/sort'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'

interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

export function Knowledge() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { knowledgeBases, isLoading, error, addKnowledgeBase, refreshList } =
    useKnowledgeBasesList(workspaceId)
  const userPermissions = useUserPermissionsContext()

  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortOption>('updatedAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const currentSortValue = `${sortBy}-${sortOrder}`
  const currentSortLabel =
    SORT_OPTIONS.find((opt) => opt.value === currentSortValue)?.label || 'Last Updated'

  const handleSortChange = (value: string) => {
    const [field, order] = value.split('-') as [SortOption, SortOrder]
    setSortBy(field)
    setSortOrder(order)
  }

  const handleKnowledgeBaseCreated = (newKnowledgeBase: KnowledgeBaseData) => {
    addKnowledgeBase(newKnowledgeBase)
  }

  const handleRetry = () => {
    refreshList()
  }

  const filteredAndSortedKnowledgeBases = useMemo(() => {
    const filtered = filterKnowledgeBases(knowledgeBases, searchQuery)
    return sortKnowledgeBases(filtered, sortBy, sortOrder)
  }, [knowledgeBases, searchQuery, sortBy, sortOrder])

  const formatKnowledgeBaseForDisplay = (kb: KnowledgeBaseWithDocCount) => ({
    id: kb.id,
    title: kb.name,
    docCount: kb.docCount || 0,
    description: kb.description || 'No description provided',
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
  })

  const breadcrumbs = [{ id: 'knowledge', label: 'Knowledge' }]

  return (
    <>
      <div className='flex h-screen flex-col pl-64'>
        {/* Header */}
        <KnowledgeHeader breadcrumbs={breadcrumbs} />

        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-hidden'>
            {/* Main Content */}
            <div className='flex-1 overflow-auto'>
              <div className='px-6 pb-6'>
                {/* Search and Create Section */}
                <div className='mb-4 flex items-center justify-between pt-1'>
                  <SearchInput
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder='Search knowledge bases...'
                  />

                  <div className='flex items-center gap-2'>
                    {/* Sort Dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='outline' className={filterButtonClass}>
                          {currentSortLabel}
                          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align='end'
                        side='bottom'
                        avoidCollisions={false}
                        sideOffset={4}
                        className={dropdownContentClass}
                      >
                        <div className={`${commandListClass} py-1`}>
                          {SORT_OPTIONS.map((option, index) => (
                            <div key={option.value}>
                              <DropdownMenuItem
                                onSelect={() => handleSortChange(option.value)}
                                className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                              >
                                <span>{option.label}</span>
                                {currentSortValue === option.value && (
                                  <Check className='h-4 w-4 text-muted-foreground' />
                                )}
                              </DropdownMenuItem>
                              {index === 0 && <DropdownMenuSeparator />}
                            </div>
                          ))}
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Create Button */}
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <PrimaryButton
                          onClick={() => setIsCreateModalOpen(true)}
                          disabled={userPermissions.canEdit !== true}
                        >
                          <Plus className='h-3.5 w-3.5' />
                          <span>Create</span>
                        </PrimaryButton>
                      </Tooltip.Trigger>
                      {userPermissions.canEdit !== true && (
                        <Tooltip.Content>
                          Write permission required to create knowledge bases
                        </Tooltip.Content>
                      )}
                    </Tooltip.Root>
                  </div>
                </div>

                {/* Error State */}
                {error && (
                  <div className='mb-4 rounded-md border border-red-200 bg-red-50 p-4'>
                    <p className='text-red-800 text-sm'>Error loading knowledge bases: {error}</p>
                    <button
                      onClick={handleRetry}
                      className='mt-2 text-red-600 text-sm underline hover:text-red-800'
                    >
                      Try again
                    </button>
                  </div>
                )}

                {/* Content Area */}
                {isLoading ? (
                  <KnowledgeBaseCardSkeletonGrid count={8} />
                ) : (
                  <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                    {filteredAndSortedKnowledgeBases.length === 0 ? (
                      knowledgeBases.length === 0 ? (
                        <EmptyStateCard
                          title='Create your first knowledge base'
                          description={
                            userPermissions.canEdit === true
                              ? 'Upload your documents to create a knowledge base for your agents.'
                              : 'Knowledge bases will appear here. Contact an admin to create knowledge bases.'
                          }
                          buttonText={
                            userPermissions.canEdit === true
                              ? 'Create Knowledge Base'
                              : 'Contact Admin'
                          }
                          onClick={
                            userPermissions.canEdit === true
                              ? () => setIsCreateModalOpen(true)
                              : () => {}
                          }
                          icon={<LibraryBig className='h-4 w-4 text-muted-foreground' />}
                        />
                      ) : (
                        <div className='col-span-full py-12 text-center'>
                          <p className='text-muted-foreground'>
                            No knowledge bases match your search.
                          </p>
                        </div>
                      )
                    ) : (
                      filteredAndSortedKnowledgeBases.map((kb) => {
                        const displayData = formatKnowledgeBaseForDisplay(
                          kb as KnowledgeBaseWithDocCount
                        )
                        return (
                          <BaseOverview
                            key={kb.id}
                            id={displayData.id}
                            title={displayData.title}
                            docCount={displayData.docCount}
                            description={displayData.description}
                            createdAt={displayData.createdAt}
                            updatedAt={displayData.updatedAt}
                          />
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      <CreateModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onKnowledgeBaseCreated={handleKnowledgeBaseCreated}
      />
    </>
  )
}
