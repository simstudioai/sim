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
    <Card className="overflow-hidden flex flex-col h-full">
      {/* Thumbnail area skeleton */}
      <div className="h-40 relative overflow-hidden bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-800 dark:to-slate-700">
        <Skeleton className="h-full w-full" />
      </div>
      <div className="flex flex-col flex-grow">
        {/* Title skeleton */}
        <CardHeader className="p-4 pb-2">
          <Skeleton className="h-4 w-3/4" />
        </CardHeader>
        {/* Description skeleton */}
        <CardContent className="p-4 pt-0 pb-2 flex-grow flex flex-col">
          <Skeleton className="h-3 w-full mb-1" />
          <Skeleton className="h-3 w-4/5" />
        </CardContent>
        {/* Footer with author and stats skeletons */}
        <CardFooter className="p-4 pt-2 mt-auto flex justify-between items-center">
          <Skeleton className="h-3 w-1/4" />
          <div className="flex items-center space-x-3">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-10" />
          </div>
        </CardFooter>
      </div>
    </Card>
  )
}
