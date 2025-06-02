'use client'

import { LibraryBig, Search } from 'lucide-react'
import Link from 'next/link'
import { useSidebarStore } from '@/stores/sidebar/store'
import { DocumentTableSkeleton } from '../../components/skeletons/table-skeleton'

interface KnowledgeBaseLoadingProps {
  knowledgeBaseName: string
}

export function KnowledgeBaseLoading({ knowledgeBaseName }: KnowledgeBaseLoadingProps) {
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  return (
    <div
      className={`flex h-[100vh] flex-col transition-padding duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
      {/* Fixed Header with Breadcrumbs */}
      <div className='flex items-center gap-2 px-6 pt-[14px] pb-6'>
        <Link
          href='/w/knowledge'
          prefetch={true}
          className='group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground'
        >
          <LibraryBig className='h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70' />
          <span>Knowledge</span>
        </Link>
        <span className='text-muted-foreground'>/</span>
        <span className='font-medium text-sm'>{knowledgeBaseName}</span>
      </div>

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto pt-[4px]'>
            <div className='px-6 pb-6'>
              {/* Search and Create Section */}
              <div className='mb-4 flex items-center justify-between'>
                <div className='relative max-w-md flex-1'>
                  <div className='relative flex items-center'>
                    <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
                    <input
                      type='text'
                      placeholder='Search documents...'
                      disabled
                      className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    />
                  </div>
                </div>

                {/* <button
                  disabled
                  className='flex items-center gap-1 rounded-md bg-[#701FFC] px-3 py-[7px] font-[480] text-primary-foreground text-sm shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:opacity-50'
                >
                  <Plus className='h-4 w-4 font-[480]' />
                  <span>Add Document</span>
                </button> */}
              </div>

              {/* Table container */}
              <DocumentTableSkeleton isSidebarCollapsed={isSidebarCollapsed} rowCount={8} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
