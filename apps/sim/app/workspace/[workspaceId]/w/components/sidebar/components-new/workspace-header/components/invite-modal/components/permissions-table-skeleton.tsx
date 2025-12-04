import React from 'react'
import { Skeleton } from '@/components/ui/skeleton'

export const PermissionsTableSkeleton = React.memo(() => (
  <div className='scrollbar-hide max-h-[300px] overflow-y-auto'>
    <div className='flex items-center justify-between gap-[8px] py-[8px]'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-[8px]'>
          <Skeleton className='h-[14px] w-40 rounded-[4px]' />
        </div>
      </div>
      <div className='flex flex-shrink-0 items-center'>
        <div className='inline-flex gap-[2px]'>
          <Skeleton className='h-[26px] w-[44px] rounded-[4px]' />
          <Skeleton className='h-[26px] w-[44px] rounded-[4px]' />
          <Skeleton className='h-[26px] w-[44px] rounded-[4px]' />
        </div>
      </div>
    </div>
  </div>
))

PermissionsTableSkeleton.displayName = 'PermissionsTableSkeleton'
