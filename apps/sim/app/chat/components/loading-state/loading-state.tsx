'use client'

import { Skeleton } from '@/components/ui/skeleton'

export function ChatLoadingState() {
  return (
    <div className='bg-white'>
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            {/* Title skeleton */}
            <div className='space-y-2 text-center'>
              <Skeleton className='mx-auto h-8 w-32' />
              <Skeleton className='mx-auto h-4 w-48' />
            </div>

            {/* Form skeleton */}
            <div className='mt-8 w-full space-y-8'>
              <div className='space-y-2'>
                <Skeleton className='h-4 w-16' />
                <Skeleton className='h-10 w-full rounded-[10px]' />
              </div>
              <Skeleton className='h-10 w-full rounded-[10px]' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
