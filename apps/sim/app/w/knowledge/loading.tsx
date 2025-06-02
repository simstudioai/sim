'use client'

import { LibraryBig, Plus, Search } from 'lucide-react'
import { useSidebarStore } from '@/stores/sidebar/store'
import { KnowledgeBaseCardSkeletonGrid } from './components/skeletons/knowledge-base-card-skeleton'

export default function KnowledgeLoading() {
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  return (
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
                  placeholder='Search knowledge bases...'
                  disabled
                  className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                />
              </div>
            </div>

            <button
              disabled
              className='flex items-center gap-1 rounded-md bg-[#701FFC] px-3 py-[7px] font-[480] text-primary-foreground text-sm shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:opacity-50'
            >
              <Plus className='h-4 w-4 font-[480]' />
              <span>Create</span>
            </button>
          </div>

          {/* Content Area */}
          <KnowledgeBaseCardSkeletonGrid count={8} />
        </div>
      </div>
    </div>
  )
}
