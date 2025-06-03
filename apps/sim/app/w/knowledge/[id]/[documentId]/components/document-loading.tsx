'use client'

import { Search } from 'lucide-react'
import { useSidebarStore } from '@/stores/sidebar/store'
import { KnowledgeHeader } from '../../../components/knowledge-header/knowledge-header'
import { ChunkTableSkeleton } from '../../../components/skeletons/table-skeleton'

interface DocumentLoadingProps {
  knowledgeBaseId: string
  knowledgeBaseName: string
  documentName: string
}

export function DocumentLoading({
  knowledgeBaseId,
  knowledgeBaseName,
  documentName,
}: DocumentLoadingProps) {
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  const breadcrumbs = [
    {
      id: 'knowledge-root',
      label: 'Knowledge',
      href: '/w/knowledge',
    },
    {
      id: `knowledge-base-${knowledgeBaseId}`,
      label: knowledgeBaseName,
      href: `/w/knowledge/${knowledgeBaseId}`,
    },
    {
      id: `document-${knowledgeBaseId}-${documentName}`,
      label: documentName,
    },
  ]

  return (
    <div
      className={`flex h-[100vh] flex-col transition-padding duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
      {/* Header with Breadcrumbs */}
      <KnowledgeHeader breadcrumbs={breadcrumbs} />

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto'>
            <div className='px-6 pb-6'>
              {/* Search Section */}
              <div className='mb-4'>
                <div className='relative max-w-md'>
                  <div className='relative flex items-center'>
                    <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
                    <input
                      type='text'
                      placeholder='Search chunks...'
                      disabled
                      className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    />
                  </div>
                </div>
              </div>

              {/* Table container */}
              <ChunkTableSkeleton isSidebarCollapsed={isSidebarCollapsed} rowCount={8} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
