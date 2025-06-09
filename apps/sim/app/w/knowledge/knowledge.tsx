'use client'

import { useMemo, useState } from 'react'
import { LibraryBig, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'
import { useSidebarStore } from '@/stores/sidebar/store'
import { BaseOverview } from './components/base-overview/base-overview'
import { CreateModal } from './components/create-modal/create-modal'
import { EmptyStateCard } from './components/empty-state-card/empty-state-card'
import { KnowledgeHeader } from './components/knowledge-header/knowledge-header'
import { KnowledgeBaseCardSkeletonGrid } from './components/skeletons/knowledge-base-card-skeleton'

interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

export function Knowledge() {
  const { mode, isExpanded } = useSidebarStore()
  const { knowledgeBases, isLoading, error, addKnowledgeBase, refreshList } =
    useKnowledgeBasesList()

  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const handleKnowledgeBaseCreated = (newKnowledgeBase: KnowledgeBaseData) => {
    addKnowledgeBase(newKnowledgeBase)
  }

  const handleRetry = () => {
    refreshList()
  }

  const filteredKnowledgeBases = useMemo(() => {
    if (!searchQuery.trim()) return knowledgeBases

    const query = searchQuery.toLowerCase()
    return knowledgeBases.filter(
      (kb) => kb.name.toLowerCase().includes(query) || kb.description?.toLowerCase().includes(query)
    )
  }, [knowledgeBases, searchQuery])

  const formatKnowledgeBaseForDisplay = (kb: KnowledgeBaseWithDocCount) => ({
    id: kb.id,
    title: kb.name,
    docCount: kb.docCount || 0,
    description: kb.description || 'No description provided',
  })

  const breadcrumbs = [{ id: 'knowledge', label: 'Knowledge' }]

  return (
    <>
      <div
        className={`flex h-screen flex-col transition-padding duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
      >
        {/* Header */}
        <KnowledgeHeader breadcrumbs={breadcrumbs} />

        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-hidden'>
            {/* Main Content */}
            <div className='flex-1 overflow-auto'>
              <div className='px-6 pb-6'>
                {/* Search and Create Section */}
                <div className='mb-4 flex items-center justify-between pt-1'>
                  <div className='relative max-w-md flex-1'>
                    <div className='relative flex items-center'>
                      <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
                      <input
                        type='text'
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder='Search knowledge bases...'
                        className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className='-translate-y-1/2 absolute top-1/2 right-3 transform text-muted-foreground hover:text-foreground'
                        >
                          <X className='h-[18px] w-[18px]' />
                        </button>
                      )}
                    </div>
                  </div>

                  <Button
                    onClick={() => setIsCreateModalOpen(true)}
                    size='sm'
                    className='flex items-center gap-1 bg-[#701FFC] font-[480] text-primary-foreground shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                  >
                    <Plus className='h-3.5 w-3.5' />
                    <span>Create</span>
                  </Button>
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
                    {filteredKnowledgeBases.length === 0 ? (
                      knowledgeBases.length === 0 ? (
                        <EmptyStateCard
                          title='Create your first knowledge base'
                          description='Upload your documents to create a knowledge base for your agents.'
                          buttonText='Create Knowledge Base'
                          onClick={() => setIsCreateModalOpen(true)}
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
                      filteredKnowledgeBases.map((kb) => {
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
