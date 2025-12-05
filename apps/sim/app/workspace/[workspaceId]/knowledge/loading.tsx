'use client'

import { LibraryBig, Search } from 'lucide-react'
import { Button } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { KnowledgeBaseCardSkeletonGrid } from '@/app/workspace/[workspaceId]/knowledge/components'

/**
 * Loading skeleton for the Knowledge page
 * Displays placeholder UI while knowledge bases are being fetched
 */
export default function KnowledgeLoading() {
  return (
    <div className='flex h-[100vh] flex-col pl-64'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[24px] pb-[24px]'>
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#1E5A3E] bg-[#0F3D2C]'>
                <LibraryBig className='h-[14px] w-[14px] text-[#34D399]' />
              </div>
              <h1 className='font-medium text-[18px]'>Knowledge</h1>
            </div>
            <p className='mt-[10px] font-base text-[#888888] text-[14px]'>
              Create and manage knowledge bases to power your AI agents with custom data.
            </p>
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-5)] px-[8px]'>
              <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
              <Input
                placeholder='Search'
                disabled
                className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
            <div className='flex items-center gap-[8px]'>
              <Button disabled variant='active' className='h-[32px] rounded-[6px]'>
                Create
              </Button>
            </div>
          </div>

          <div className='mt-[24px] h-[1px] w-full border-[var(--border)] border-t' />

          <div className='mt-[24px] grid grid-cols-1 gap-x-[20px] gap-y-[40px] md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
            <KnowledgeBaseCardSkeletonGrid count={8} />
          </div>
        </div>
      </div>
    </div>
  )
}
