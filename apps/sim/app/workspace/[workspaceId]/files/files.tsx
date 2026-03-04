'use client'

import { Files as FilesIcon } from 'lucide-react'
import { FileList } from '@/app/workspace/[workspaceId]/files/components/file-list'

export function Files() {
  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[28px] pb-[24px] dark:bg-[var(--bg)]'>
          {/* Header */}
          <div>
            <div className='flex items-start gap-[12px]'>
              <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#8B5CF6] bg-[#F5F3FF] dark:border-[#5B21B6] dark:bg-[#2E1065]'>
                <FilesIcon className='h-[14px] w-[14px] text-[#8B5CF6] dark:text-[#A78BFA]' />
              </div>
              <h1 className='font-medium text-[18px]'>Files</h1>
            </div>
            <p className='mt-[10px] text-[14px] text-[var(--text-tertiary)]'>
              Workspace files accessible across all workflows.
            </p>
          </div>

          {/* Search, Actions, and Content */}
          <FileList />
        </div>
      </div>
    </div>
  )
}
