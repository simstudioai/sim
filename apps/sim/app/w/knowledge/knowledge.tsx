'use client'

import { useEffect, useState } from 'react'
import { LibraryBig, Plus, Search, X } from 'lucide-react'
import { useSidebarStore } from '@/stores/sidebar/store'
import { BaseOverview } from './components/base-overview/base-overview'
import { CreateModal } from './components/create-modal/create-modal'
import { EmptyStateCard } from './components/empty-state-card/empty-state-card'
import { KnowledgeBaseCardSkeletonGrid } from './components/skeletons/knowledge-base-card-skeleton'

interface KnowledgeBase {
  id: string
  name: string
  description?: string
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: any
  createdAt: string
  updatedAt: string
  workspaceId?: string
  docCount?: number
}

export function Knowledge() {
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch knowledge bases on component mount
  useEffect(() => {
    const fetchKnowledgeBases = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch('/api/knowledge')

        if (!response.ok) {
          throw new Error(`Failed to fetch knowledge bases: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setKnowledgeBases(result.data)
        } else {
          throw new Error(result.error || 'Failed to fetch knowledge bases')
        }
      } catch (err) {
        console.error('Error fetching knowledge bases:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoading(false)
      }
    }

    fetchKnowledgeBases()
  }, [])

  // Handle knowledge base creation success
  const handleKnowledgeBaseCreated = (newKnowledgeBase: KnowledgeBase) => {
    setKnowledgeBases((prev) => [newKnowledgeBase, ...prev])
  }

  // Filter knowledge bases based on search query
  const filteredKnowledgeBases = knowledgeBases.filter(
    (kb) =>
      kb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kb.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Format document count for display
  const formatKnowledgeBaseForDisplay = (kb: KnowledgeBase) => ({
    id: kb.id,
    title: kb.name,
    docCount: kb.docCount || 0,
    description: kb.description || 'No description provided',
  })

  return (
    <>
      <div
        className={`fixed inset-0 flex flex-col transition-all duration-200 ${isSidebarCollapsed ? 'left-14' : 'left-60'}`}
      >
        {/* Fixed Header */}
        <div className='flex items-center gap-2 px-6 pt-4 pb-6'>
          <LibraryBig className='h-[18px] w-[18px] text-muted-foreground' />
          <h1 className='font-medium text-sm'>Knowledge</h1>
        </div>

        {/* Main Content */}
        <div className='flex-1 overflow-auto pt-[6px]'>
          <div className='px-6 pb-6'>
            {/* Search and Create Section */}
            <div className='mb-6 flex items-center justify-between'>
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

              <button
                onClick={() => setIsCreateModalOpen(true)}
                className='flex items-center gap-1 rounded-md bg-[#701FFC] px-3 py-[7px] font-[480] text-primary-foreground text-sm shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
              >
                <Plus className='h-4 w-4 font-[480]' />
                <span>Create</span>
              </button>
            </div>

            {/* Error State */}
            {error && (
              <div className='mb-6 rounded-md border border-red-200 bg-red-50 p-4'>
                <p className='text-red-800 text-sm'>Error loading knowledge bases: {error}</p>
                <button
                  onClick={() => window.location.reload()}
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
                      <p className='text-muted-foreground'>No knowledge bases match your search.</p>
                    </div>
                  )
                ) : (
                  filteredKnowledgeBases.map((kb) => {
                    const displayData = formatKnowledgeBaseForDisplay(kb)
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

      {/* Create Modal */}
      <CreateModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onKnowledgeBaseCreated={handleKnowledgeBaseCreated}
      />
    </>
  )
}
