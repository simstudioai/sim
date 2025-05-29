'use client'

import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * WorkflowCardSkeleton - Loading placeholder component for workflow cards
 * Displays a skeleton UI while workflow data is being fetched
 * Maintains the same structure as WorkflowCard for consistent layout during loading
 */
export function WorkflowCardSkeleton() {
  return (
    <Card className='flex h-full flex-col overflow-hidden'>
      {/* Thumbnail area skeleton */}
      <div className='relative h-40 overflow-hidden bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-800 dark:to-slate-700'>
        <Skeleton className='h-full w-full' />
      </div>
      <div className='flex flex-grow flex-col'>
        {/* Title skeleton */}
        <CardHeader className='p-4 pb-2'>
          <Skeleton className='h-4 w-3/4' />
        </CardHeader>
        {/* Description skeleton */}
        <CardContent className='flex flex-grow flex-col p-4 pt-0 pb-2'>
          <Skeleton className='mb-1 h-3 w-full' />
          <Skeleton className='h-3 w-4/5' />
        </CardContent>
        {/* Footer with author and views skeletons */}
        <CardFooter className='mt-auto flex items-center justify-between p-4 pt-2'>
          <Skeleton className='h-3 w-1/4' />
          <Skeleton className='h-3 w-10' />
        </CardFooter>
      </div>
    </Card>
  )
}
