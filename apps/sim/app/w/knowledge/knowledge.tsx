'use client'

import { LibraryBig, Plus, Search, X } from 'lucide-react'
import { BaseOverview } from './components/base-overview/base-overview'
import { CreateModal } from './components/create-modal/create-modal'
import { EmptyStateCard } from './components/empty-state-card/empty-state-card'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useState } from 'react'

interface KnowledgeBase {
  id: string
  title: string
  docCount: number
  tokenCount: string
  description: string
}

export function Knowledge() {
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // Sample data for knowledge base cards
  const knowledgeBases: KnowledgeBase[] = []

  // Filter knowledge bases based on search query
  const filteredKnowledgeBases = knowledgeBases.filter(
    (kb) =>
      kb.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kb.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <>
      <div
        className={`fixed inset-0 flex flex-col transition-all duration-200 ${isSidebarCollapsed ? 'left-14' : 'left-60'}`}
      >
        {/* Fixed Header */}
        <div className="flex items-center gap-2 px-6 pt-4 pb-6">
          <LibraryBig className="h-[18px] w-[18px] text-muted-foreground" />
          <h1 className="font-medium text-sm">Knowledge</h1>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto pt-[6px]">
          <div className="px-6 pb-6">
            {/* Info cards */}
            {/* <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="col-span-2 bg-background border rounded-md p-6 min-h-[280px]">
              </div>
              <div className="col-span-1 bg-background border rounded-md p-6 min-h-[280px]">
              </div>
            </div> */}

            {/* Search and Create Section */}
            <div className="flex items-center justify-between mb-6">
              <div className="relative flex-1 max-w-md">
                <div className="relative flex items-center">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search knowledge bases..."
                    className="h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-[18px] w-[18px]" />
                    </button>
                  )}
                </div>
              </div>

              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-1 px-3 py-[7px] bg-[#701FFC] text-primary-foreground rounded-md shadow-[0_0_0_0_#701FFC] hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] transition-all duration-200 text-sm font-[480]"
              >
                <Plus className="w-4 h-4 font-[480]" />
                <span>Create</span>
              </button>
            </div>

            {/* Knowledge Base Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredKnowledgeBases.length === 0 ? (
                <EmptyStateCard
                  title="Create your first knowledge base"
                  description="Upload your documents to create a knowledge base for your agents."
                  buttonText="Create Knowledge Base"
                  onClick={() => setIsCreateModalOpen(true)}
                  icon={
                    <LibraryBig className="w-4 h-4 text-muted-foreground" />
                  }
                />
              ) : (
                filteredKnowledgeBases.map((kb, index) => (
                  <BaseOverview
                    key={index}
                    id={kb.id}
                    title={kb.title}
                    docCount={kb.docCount}
                    tokenCount={kb.tokenCount}
                    description={kb.description}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      <CreateModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
      />
    </>
  )
}
